use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use wasmtime::component::{Component, HasSelf, Linker};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};

wasmtime::component::bindgen!({
    path: "../../schemas/wasm",
    world: "plugin",
});
use crate::logicpilot::plugin::{host_log, host_random, host_service};
use crate::logicpilot::plugin::host_service::Host as _;

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    kind: String,
}

#[derive(Debug, Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone)]
struct CapabilityBridge {
    output: Arc<Mutex<io::BufWriter<io::Stdout>>>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<host_service::CapabilityResponse>>>>,
    next_id: Arc<Mutex<u64>>,
    timeout: Duration,
}

impl CapabilityBridge {
    fn invoke(&self, request: host_service::CapabilityRequest) -> host_service::CapabilityResponse {
        let id = {
            let mut next = self
                .next_id
                .lock()
                .expect("capability sequence mutex poisoned");
            *next += 1;
            *next
        };
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .expect("capability pending mutex poisoned")
            .insert(id, sender);
        let notification = serde_json::json!({
            "kind": "capability-request",
            "id": id,
            "capability": request.capability,
            "operation": request.operation,
            "payloadJson": request.payload_json,
        });
        if write_line(&self.output, &notification).is_err() {
            self.pending
                .lock()
                .expect("capability pending mutex poisoned")
                .remove(&id);
            return denied_response("runner-output-failed");
        }
        let response = receiver
            .recv_timeout(self.timeout)
            .unwrap_or_else(|_| denied_response("capability-timeout"));
        self.pending
            .lock()
            .expect("capability pending mutex poisoned")
            .remove(&id);
        response
    }
}

struct HostState {
    bridge: CapabilityBridge,
    capabilities: HashSet<String>,
    limits: StoreLimits,
    denied_import: Option<String>,
}

impl host_log::Host for HostState {
    fn log(&mut self, level: u32, value: u32) {
        let response = self.invoke(host_service::CapabilityRequest {
            capability: "runtime.log".to_string(), operation: "write".to_string(),
            payload_json: serde_json::json!({"level":level,"value":value}).to_string(),
        });
        if !response.ok { self.denied_import = Some("log capability denied".to_string()); }
    }
}

impl host_random::Host for HostState {
    fn random_u32(&mut self) -> u32 {
        let response = self.invoke(host_service::CapabilityRequest {
            capability: "runtime.random".to_string(), operation: "read".to_string(),
            payload_json: "null".to_string(),
        });
        if response.ok {
            if let Ok(value) = serde_json::from_str::<u32>(&response.payload_json) { return value; }
        }
        self.denied_import = Some("random capability denied or invalid".to_string());
        0
    }
}

impl host_service::Host for HostState {
    fn invoke(
        &mut self,
        request: host_service::CapabilityRequest,
    ) -> host_service::CapabilityResponse {
        if !self.capabilities.contains(&request.capability) {
            return denied_response("permission-denied");
        }
        self.bridge.invoke(request)
    }
}

fn main() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    let component_path = PathBuf::from(
        arguments
            .next()
            .context("usage: logicpilot-component-runner <component.wasm>")?,
    );
    let mut capabilities = HashSet::new();
    let mut max_memory_bytes: usize = 64 * 1024 * 1024;
    let mut timeout_ms: u64 = 10_000;
    while let Some(argument) = arguments.next() {
        let value = arguments.next().context("missing runner option value")?;
        match argument.as_str() {
            "--capability" => { capabilities.insert(value); }
            "--max-memory-bytes" => max_memory_bytes = value.parse()?,
            "--capability-timeout-ms" => timeout_ms = value.parse()?,
            _ => anyhow::bail!("unknown runner option"),
        }
    }
    anyhow::ensure!((65536..=1024 * 1024 * 1024).contains(&max_memory_bytes), "invalid memory quota");
    anyhow::ensure!((1..=630_000).contains(&timeout_ms), "invalid RPC timeout");
    let mut config = Config::new();
    config.wasm_component_model(true);
    config.consume_fuel(true);
    let engine = Engine::new(&config)?;
    let component = Component::from_file(&engine, &component_path).map_err(|error| {
        anyhow::anyhow!(
            "cannot load component {}: {error}",
            component_path.display()
        )
    })?;
    let output = Arc::new(Mutex::new(io::BufWriter::new(io::stdout())));
    let pending: Arc<Mutex<HashMap<u64, mpsc::Sender<host_service::CapabilityResponse>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(Mutex::new(0));
    let (commands_tx, commands_rx) = mpsc::channel::<Request>();
    let pending_reader = pending.clone();
    thread::spawn(move || {
        let mut input = io::stdin().lock();
        while let Ok(Some(line)) = read_bounded_line(&mut input) {
            if line.trim().is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => break,
            };
            if value.get("kind").and_then(serde_json::Value::as_str) == Some("capability-response")
            {
                let id = value.get("id").and_then(serde_json::Value::as_u64);
                let response = host_service::CapabilityResponse {
                    ok: value
                        .get("ok")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    payload_json: value
                        .get("payloadJson")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("null")
                        .to_string(),
                    error_code: value
                        .get("errorCode")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                };
                if let Some(id) = id {
                    if let Some(sender) = pending_reader
                        .lock()
                        .expect("capability pending mutex poisoned")
                        .remove(&id)
                    {
                        let _ = sender.send(response);
                    }
                }
            } else if let Ok(request) = serde_json::from_value::<Request>(value) {
                let _ = commands_tx.send(request);
            }
        }
    });
    let bridge = CapabilityBridge {
        output,
        pending,
        next_id,
        timeout: Duration::from_millis(timeout_ms),
    };
    let mut linker: Linker<HostState> = Linker::new(&engine);
    Plugin::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)?;
    let mut store = Store::new(
        &engine,
        HostState {
            bridge,
            capabilities,
            limits: StoreLimitsBuilder::new().memory_size(max_memory_bytes).table_elements(10000)
                .instances(16).memories(16).trap_on_grow_failure(true).build(),
            denied_import: None,
        },
    );
    store.set_fuel(10_000_000)?;
    store.limiter(|host| &mut host.limits);
    let plugin = Plugin::instantiate(&mut store, &component, &linker)
        .map_err(|error| anyhow::anyhow!("cannot instantiate LogicPilot component: {error}"))?;
    for request in commands_rx {
        store.set_fuel(10_000_000)?;
        store.data_mut().denied_import = None;
        let mut response = match request.kind.as_str() {
            "activate" => match plugin.call_logicpilot_abi_version(&mut store) {
                Ok(1) => match plugin.call_activate(&mut store) {
                    Ok(Ok(())) => Response {
                        id: request.id,
                        ok: true,
                        error: None,
                    },
                    Ok(Err(error)) => Response {
                        id: request.id,
                        ok: false,
                        error: Some(error),
                    },
                    Err(error) => Response {
                        id: request.id,
                        ok: false,
                        error: Some(error.to_string()),
                    },
                },
                Ok(_) => Response { id: request.id, ok: false, error: Some("unsupported ABI version".to_string()) },
                Err(error) => Response {
                    id: request.id,
                    ok: false,
                    error: Some(error.to_string()),
                },
            },
            "deactivate" => match plugin.call_deactivate(&mut store) {
                Ok(Ok(())) => Response {
                    id: request.id,
                    ok: true,
                    error: None,
                },
                Ok(Err(error)) => Response {
                    id: request.id,
                    ok: false,
                    error: Some(error),
                },
                Err(error) => Response {
                    id: request.id,
                    ok: false,
                    error: Some(error.to_string()),
                },
            },
            _ => Response {
                id: request.id,
                ok: false,
                error: Some("unknown-command".to_string()),
            },
        };
        if let Some(error) = store.data_mut().denied_import.take() {
            response.ok = false;
            response.error = Some(error);
        }
        write_line(&store.data().bridge.output, &response)?;
    }
    Ok(())
}

fn denied_response(code: &str) -> host_service::CapabilityResponse {
    host_service::CapabilityResponse {
        ok: false,
        payload_json: "null".to_string(),
        error_code: Some(code.to_string()),
    }
}

fn read_bounded_line(input: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut line = Vec::new();
    loop {
        let available = input.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() { Ok(None) } else { Err(io::Error::other("truncated RPC frame")) };
        }
        let count = available.iter().position(|byte| *byte == b'\n').map(|i| i + 1).unwrap_or(available.len());
        if line.len() + count > 256 * 1024 { return Err(io::Error::other("RPC frame too large")); }
        let complete = available[count - 1] == b'\n';
        line.extend_from_slice(&available[..count]);
        input.consume(count);
        if complete { return String::from_utf8(line).map(Some).map_err(io::Error::other); }
    }
}

fn write_line<T: Serialize>(
    output: &Arc<Mutex<io::BufWriter<io::Stdout>>>,
    value: &T,
) -> io::Result<()> {
    let mut output = output.lock().expect("runner output mutex poisoned");
    serde_json::to_writer(&mut *output, value).map_err(io::Error::other)?;
    output.write_all(b"\n")?;
    output.flush()
}
