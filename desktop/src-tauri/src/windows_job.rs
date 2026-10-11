//! Windows process-tree lifetime guard for the Tauri-owned app server.
//!
//! A taskkill issued during a normal ExitRequested event is only a best-effort
//! cleanup path. This Job Object is owned by the desktop process itself and is
//! configured with KILL_ON_JOB_CLOSE, so a crash or force-quit closes the job
//! handle and Windows terminates the app server and every descendant.

#![cfg(windows)]

use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct JobGuard {
    handle: HANDLE,
}

impl JobGuard {
    pub fn for_child(child: &Child) -> io::Result<Self> {
        // A null name creates a private unnamed job. The desktop process keeps
        // this handle until shutdown; closing it activates the kill-on-close
        // policy even if the normal ExitRequested callback never runs.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(last_error());
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: unsafe { std::mem::zeroed() },
            IoInfo: unsafe { std::mem::zeroed() },
            ProcessMemoryLimit: 0,
            JobMemoryLimit: 0,
            PeakProcessMemoryUsed: 0,
            PeakJobMemoryUsed: 0,
        };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle) };
            return Err(last_error());
        }
        let process = child.as_raw_handle() as HANDLE;
        if unsafe { AssignProcessToJobObject(handle, process) } == 0 {
            let error = last_error();
            unsafe { CloseHandle(handle) };
            return Err(error);
        }
        Ok(Self { handle })
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { CloseHandle(self.handle) };
            self.handle = std::ptr::null_mut();
        }
    }
}

fn last_error() -> io::Error {
    io::Error::from_raw_os_error(unsafe { GetLastError() } as i32)
}

#[cfg(test)]
mod tests {
    use super::JobGuard;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn closing_the_guard_terminates_the_child_tree() {
        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping", "127.0.0.1", "-n", "20"])
            .spawn()
            .expect("spawn test child");
        let guard = JobGuard::for_child(&child).expect("assign child to job");
        drop(guard);
        for _ in 0..20 {
            if child.try_wait().expect("poll child").is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("job close did not terminate the child");
    }
}
