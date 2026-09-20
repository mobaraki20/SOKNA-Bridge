# Command Delivery Contract v1
- One plain-text command per assistant turn.
- Every command has a unique id and explicit Read-only or Write scope.
- Chat commands stay short; complex patches use files or artifacts.
- No silent failure: detect, parse, execute, timeout, and delivery errors must become results.
- Pending results persist across reload and retry automatically.
- A result is complete only after confirmed delivery.
- SoknaCafe remains read-only unless explicitly changed.
