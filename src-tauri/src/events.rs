use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::deploy::NodeRecord;
use crate::error::AppResult;

pub const DEPLOY_EVENT: &str = "deploy-event";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeployEventPayload {
    Step { step: String, label: String },
    Log { line: String },
    Done { node: NodeRecord },
    Error { step: String, message: String },
}

pub struct TauriProgressSink {
    app: Arc<AppHandle>,
}

impl TauriProgressSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app: Arc::new(app) }
    }

    pub fn emit(&self, payload: DeployEventPayload) -> AppResult<()> {
        self.app
            .emit(DEPLOY_EVENT, payload)
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
