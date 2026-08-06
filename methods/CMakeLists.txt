# Method Runtime Layer (docs/specs/method-runtime.md).
#
# Each modeling method ships as a static library that links the kernel and
# registers itself into logicpilot::MethodRegistry. The kernel never depends
# on a specific method; drivers link the method libraries they want to
# support and call register_all_methods() (or the per-method register
# function) at startup.

add_subdirectory(process)
