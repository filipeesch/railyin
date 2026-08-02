## ADDED Requirements

### Requirement: SQLite default when config file is absent
When `config/database.yaml` does not exist, the application SHALL resolve to the SQLite engine at the existing default path (`~/.railyn/railyn.db`), preserving current behavior with no configuration required.

#### Scenario: No config file present
- **WHEN** `config/database.yaml` does not exist and `RAILYN_DB` is unset
- **THEN** the application connects to SQLite at `~/.railyn/railyn.db`

#### Scenario: Existing installs are unaffected
- **WHEN** an existing install that never created `config/database.yaml` boots after this change
- **THEN** it continues using the same SQLite file it used before, with no migration or manual step

### Requirement: Driver-tagged configuration when file is present
When `config/database.yaml` exists, it SHALL contain a top-level `driver` field with value `sqlite` or `postgres`, and a nested block matching that driver supplying its connection details. The resolver SHALL select the engine named by `driver`.

#### Scenario: Postgres driver selected
- **WHEN** `config/database.yaml` sets `driver: postgres` with a `postgres.url`
- **THEN** the application connects to PostgreSQL using that URL

#### Scenario: SQLite driver with explicit path
- **WHEN** `config/database.yaml` sets `driver: sqlite` with `sqlite.path: /data/app.db`
- **THEN** the application connects to SQLite at `/data/app.db`

#### Scenario: Unknown driver value is rejected
- **WHEN** `config/database.yaml` sets `driver` to a value other than `sqlite` or `postgres`
- **THEN** the resolver throws a descriptive error at startup and the app does not boot

#### Scenario: Missing nested block for selected driver
- **WHEN** `driver: postgres` is set but no `postgres` block (or no `url`) is provided
- **THEN** the resolver throws a descriptive error identifying the missing connection details

### Requirement: Environment override precedence
The `RAILYN_DB` environment variable SHALL take precedence over `config/database.yaml` so that tests and dev workflows can force an in-memory or file SQLite database regardless of the config file.

#### Scenario: RAILYN_DB overrides a present config file
- **WHEN** `RAILYN_DB=:memory:` is set and `config/database.yaml` selects `postgres`
- **THEN** the application connects to an in-memory SQLite database and ignores the Postgres config

#### Scenario: Config used when RAILYN_DB is unset
- **WHEN** `RAILYN_DB` is unset and `config/database.yaml` selects `postgres`
- **THEN** the Postgres configuration is used

### Requirement: Sample configuration file
The repository SHALL include `config/database.yaml.sample` documenting both the `sqlite` and `postgres` driver blocks, including the optional Postgres connection-pool settings, alongside the existing `engines.yaml.sample` and `providers.yaml.sample`.

#### Scenario: Sample documents both drivers
- **WHEN** a developer opens `config/database.yaml.sample`
- **THEN** they see a commented example for `driver: sqlite` and for `driver: postgres` (with `url` and `pool`) and the "absent file → sqlite default" convention
