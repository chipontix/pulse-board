CREATE TYPE service_status AS ENUM ('operational', 'degraded', 'down', 'unknown');
CREATE TYPE incident_status AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');
CREATE TYPE incident_impact AS ENUM ('minor', 'major', 'critical');

CREATE TABLE services (
    id                  serial PRIMARY KEY,
    slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
    name                text NOT NULL,
    url                 text NOT NULL,
    position            int  NOT NULL DEFAULT 0,
    interval_s          int  NOT NULL DEFAULT 30 CHECK (interval_s BETWEEN 1 AND 3600),
    timeout_ms          int  NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 100 AND 60000),
    expected_status     int  NOT NULL DEFAULT 200,
    degraded_latency_ms int  NOT NULL DEFAULT 1000,
    -- status derived by the worker from recent checks
    status              service_status NOT NULL DEFAULT 'unknown',
    -- manual override set from the admin panel; NULL = follow the checks
    status_override     service_status,
    status_changed_at   timestamptz NOT NULL DEFAULT now(),
    next_check_at       timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now()
);
-- worker: "which services are due"
CREATE INDEX services_next_check_idx ON services (next_check_at);

CREATE TABLE checks (
    id          bigserial PRIMARY KEY,
    service_id  int NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    checked_at  timestamptz NOT NULL DEFAULT now(),
    ok          boolean NOT NULL,
    http_status int,
    latency_ms  int NOT NULL,
    error       text
);
-- public page: uptime per service per day, last N checks per service
CREATE INDEX checks_service_time_idx ON checks (service_id, checked_at DESC) INCLUDE (ok);

CREATE TABLE incidents (
    id          serial PRIMARY KEY,
    title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    status      incident_status NOT NULL DEFAULT 'investigating',
    impact      incident_impact NOT NULL DEFAULT 'minor',
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
-- public page: open incidents; history: recent resolved ones
CREATE INDEX incidents_open_idx ON incidents (created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX incidents_resolved_idx ON incidents (resolved_at DESC) WHERE resolved_at IS NOT NULL;

CREATE TABLE incident_services (
    incident_id int NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    service_id  int NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, service_id)
);
CREATE INDEX incident_services_service_idx ON incident_services (service_id);

CREATE TABLE incident_updates (
    id          serial PRIMARY KEY,
    incident_id int NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    status      incident_status NOT NULL,
    body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    author      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_updates_incident_idx ON incident_updates (incident_id, created_at DESC);

CREATE TABLE subscriptions (
    id           serial PRIMARY KEY,
    email        text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    -- NULL = all services
    service_id   int REFERENCES services (id) ON DELETE CASCADE,
    token        text NOT NULL UNIQUE,
    confirmed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
-- one subscription per (email, service), NULL service counted as a value
CREATE UNIQUE INDEX subscriptions_email_service_idx ON subscriptions (lower(email), coalesce(service_id, 0));

CREATE TABLE admins (
    id            serial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
