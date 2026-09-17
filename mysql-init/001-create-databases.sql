-- Each service owns its own database — no cross-service joins.
-- MYSQL_DATABASE (env var) only creates one; the other four are created here.
CREATE DATABASE IF NOT EXISTS gateway_service;
CREATE DATABASE IF NOT EXISTS commerce_service;
CREATE DATABASE IF NOT EXISTS logistics_service;
CREATE DATABASE IF NOT EXISTS finance_service;
CREATE DATABASE IF NOT EXISTS growth_service;
