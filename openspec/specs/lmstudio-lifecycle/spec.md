## Purpose
The refinement harness SHALL manage the lifecycle of LM Studio models for `lmstudio`-type providers, including CLI availability checks, model loading before runs, health verification, and model unloading after runs.

## Requirements

### Requirement: Model loading before provider runs
For providers with `type: lmstudio`, the runner SHALL execute `lms load <model_key> --gpu max -y` before the provider's first scenario run and wait for the command to complete successfully.

#### Scenario: LM Studio model loaded before scenarios
- **WHEN** the runner begins execution for provider `lmstudio-qwen` with `model_key: qwen2.5-coder-32b-instruct`
- **THEN** the runner executes `lms load qwen2.5-coder-32b-instruct --gpu max -y` and waits for success before starting any scenario

#### Scenario: Model load with custom GPU setting
- **WHEN** a provider has `model_key: deepseek-coder-v2` and `gpu: 0.8`
- **THEN** the runner executes `lms load deepseek-coder-v2 --gpu 0.8 -y`

#### Scenario: Model load failure skips provider
- **WHEN** `lms load` exits with a non-zero code (e.g., model not downloaded)
- **THEN** the runner prints the error, skips the provider, and continues to the next provider

### Requirement: Model unloading after provider runs
After all scenarios for an lmstudio provider complete, the runner SHALL execute `lms unload --all` to free GPU memory before the next provider runs.

#### Scenario: Model unloaded after provider finishes
- **WHEN** all scenarios for provider `lmstudio-qwen` complete
- **THEN** the runner executes `lms unload --all`

#### Scenario: Unload runs even if scenarios fail
- **WHEN** a scenario run fails mid-execution for an lmstudio provider
- **THEN** `lms unload --all` is still executed in the cleanup phase

### Requirement: LMS CLI availability check
Before executing any lmstudio provider, the runner SHALL verify that the `lms` CLI is available by running `which lms`.

#### Scenario: LMS CLI found
- **WHEN** `which lms` returns a valid path
- **THEN** the runner proceeds with lmstudio provider execution

#### Scenario: LMS CLI not found
- **WHEN** `which lms` returns non-zero (command not found)
- **THEN** the runner prints "lms CLI not found. Install LM Studio to use lmstudio providers." and skips all lmstudio providers

### Requirement: Health check via lms ps
Before starting scenarios for an lmstudio provider, after model loading, the runner SHALL verify the model is ready by running `lms ps --json` and checking that the expected model appears in the output.

#### Scenario: Model appears in lms ps output
- **WHEN** `lms ps --json` returns a list containing the loaded model key
- **THEN** the runner proceeds with scenario execution

#### Scenario: Model not ready after load
- **WHEN** `lms ps --json` does not list the expected model key after `lms load` succeeded
- **THEN** the runner retries `lms ps --json` once after 3 seconds, then skips the provider if still not found

### Requirement: Network LM Studio via lms link
For lmstudio providers with a `link_device` field, the runner SHALL use `lms link` to access a remote LM Studio instance instead of a local one. The `host` field SHALL point to the remote device's address.

#### Scenario: Network provider uses link_device
- **WHEN** a provider has `type: lmstudio`, `link_device: macbook-pro`, `host: 192.168.1.50`
- **THEN** the runner uses `http://192.168.1.50:1234` as the backend URL and model loading/unloading is expected to be managed on the remote device

#### Scenario: Network provider skips local lms load
- **WHEN** a provider has `link_device` set
- **THEN** the runner does NOT execute `lms load` or `lms unload` locally (the remote device manages its own models)
