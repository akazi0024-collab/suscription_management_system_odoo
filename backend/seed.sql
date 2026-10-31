INSERT OR IGNORE INTO profiles (id, full_name, role)
VALUES ('orbit-local-admin', 'ORBIT Local Admin', 'admin');

INSERT OR IGNORE INTO users (id, email, password_hash)
VALUES ('orbit-local-admin', 'demo@orbit.local', 'local-demo-password-bypass');

INSERT OR IGNORE INTO staff (id, profile_id, full_name, email, permissions)
VALUES ('orbit-local-staff', 'orbit-local-admin', 'ORBIT Local Admin', 'demo@orbit.local',
        '{"customers":true,"subscriptions":true,"invoices":true,"payments":true,"reports":true}');
