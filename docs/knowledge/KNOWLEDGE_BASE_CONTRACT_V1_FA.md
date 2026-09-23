# قرارداد Operational Knowledge Base v1

سطوح: observed، confirmed، canonical، superseded. failure خام به‌تنهایی canonical نمی‌شود.

هر lesson باید `id,status,scope,symptom,root_cause,preferred_pattern,evidence,confidence,tags,last_validated` داشته باشد. Agent پیش از انتخاب environment/transport/lifecycle pattern باید KB را query کند. secret/token/signed URL وارد KB نمی‌شود.
