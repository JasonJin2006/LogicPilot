(module
  (global $target (mut i64) (i64.const 0))
  (global $count (mut i64) (i64.const 0))

  (func (export "lp_abi_version") (result i32)
    i32.const 1)

  (func (export "lp_initialize") (param i64 i64 i64) (result i32)
    local.get 1
    global.set $target
    i64.const 0
    global.set $count
    i32.const 1)

  (func (export "lp_event_count") (result i64)
    global.get $target)

  (func (export "lp_event_time_ns") (param i64) (result i64)
    local.get 0
    i64.const 1
    i64.add)

  (func (export "lp_event_type") (param i64) (result i32)
    i32.const 801)

  (func (export "lp_event_payload") (param i64) (result i64)
    local.get 0)

  (func (export "lp_on_event") (param i32 i64) (result f64)
    global.get $count
    i64.const 1
    i64.add
    global.set $count
    global.get $count
    f64.convert_i64_u)

  (func (export "lp_shutdown_arrivals") (result i64)
    global.get $count)

  (func (export "lp_shutdown_departures") (result i64)
    global.get $count)

  (func (export "lp_final_value") (result f64)
    global.get $count
    f64.convert_i64_u)
)
