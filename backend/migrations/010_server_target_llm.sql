-- Control default for LLM backend: "ollama" (local). Other values (e.g. claude, nova) are not implemented.
INSERT INTO control (key, index, value, last_update) VALUES
    ('server_target_llm', 0, 'ollama', NOW())
ON CONFLICT (key) DO NOTHING;
