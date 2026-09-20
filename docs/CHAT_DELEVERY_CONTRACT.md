# Chat Delivery Contract

- Never auto-submit over a user draft or user attachment.
- Wait while an attachment is uploading.
- Agent artifacts may submit only after upload_complete and Send is enabled.
- Queue events while the assistant is generating.
- Delivery timeouts must emit delivery_blocked; never fail silently.
