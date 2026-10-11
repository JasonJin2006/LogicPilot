(component
  (core module $guest
    (memory (export "memory") 1)
    (func (export "abi") (result i32) i32.const 1)
    ;; A canonical result<_, string> with the success discriminant at offset 0.
    (func (export "activate") (result i32) i32.const 0)
    (func (export "deactivate") (result i32) i32.const 0))
  (core instance $instance (instantiate $guest))
  (type $outcome (result (error string)))
  (func (export "logicpilot-abi-version") (result u32)
    (canon lift (core func $instance "abi")))
  (func (export "activate") (result $outcome)
    (canon lift (core func $instance "activate") (memory $instance "memory")))
  (func (export "deactivate") (result $outcome)
    (canon lift (core func $instance "deactivate") (memory $instance "memory"))))
