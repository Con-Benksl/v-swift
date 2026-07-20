use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::deploy::NodeRecord;
use crate::error::{AppError, AppResult};

const DEPLOY_EVENT_PREFIX: &str = "deploy-event-";

fn deploy_event_name(deployment_id: &str) -> AppResult<String> {
    if deployment_id.is_empty()
        || deployment_id.len() > 128
        || !deployment_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppError::Other("invalid deployment id".to_string()));
    }

    Ok(format!("{DEPLOY_EVENT_PREFIX}{deployment_id}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeployEventPayload {
    Step { step: String, label: String },
    Log { line: String },
    Done { node: NodeRecord },
    Error { step: String, message: String },
    Warning { step: String, message: String },
}

pub struct TauriProgressSink {
    app: Arc<AppHandle>,
    event_name: String,
}

impl TauriProgressSink {
    pub fn new(app: AppHandle, deployment_id: &str) -> AppResult<Self> {
        Ok(Self {
            app: Arc::new(app),
            event_name: deploy_event_name(deployment_id)?,
        })
    }

    pub fn emit(&self, payload: DeployEventPayload) -> AppResult<()> {
        self.app
            .emit(&self.event_name, payload)
            .map_err(|err| crate::error::AppError::Other(err.to_string()))
    }
}

impl crate::deploy::ProgressSink for TauriProgressSink {
    fn step(&self, step: &str, label: &str) {
        let _ = self.emit(DeployEventPayload::Step {
            step: step.to_string(),
            label: label.to_string(),
        });
    }

    fn log(&self, line: &str) {
        let _ = self.emit(DeployEventPayload::Log {
            line: line.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::deploy_event_name;

    #[test]
    fn scopes_deploy_event_to_valid_deployment_id() {
        assert_eq!(
            deploy_event_name("m123-1").expect("valid deployment id"),
            "deploy-event-m123-1"
        );
    }

    #[test]
    fn rejects_deployment_id_that_can_escape_event_namespace() {
        assert!(deploy_event_name("").is_err());
        assert!(deploy_event_name("other:event").is_err());
        assert!(deploy_event_name("../other").is_err());
    }
}
