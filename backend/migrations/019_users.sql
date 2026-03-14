-- Users table for login and future auth. Password stored in clear for now.
-- "user" is reserved in PostgreSQL so we use app_user.
CREATE TABLE IF NOT EXISTS app_user (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    firstname VARCHAR(255),
    lastname VARCHAR(255),
    password VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed Kevin (user_id = 1) and Cathy. Order ensures Kevin gets user_id 1 for tag seed in 017.
INSERT INTO app_user (username, firstname, lastname, password, is_enabled)
VALUES ('khm', 'Kevin', 'McMahon', 'astart', TRUE)
ON CONFLICT (username) DO NOTHING;

INSERT INTO app_user (username, firstname, lastname, password, is_enabled)
VALUES ('cathy', 'Cathy', 'Sullivan', 'cs2025', TRUE)
ON CONFLICT (username) DO NOTHING;
