use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use qrcode::{render::svg::Color, QrCode};

use crate::deploy::{NodeRecord, ProtocolId};
use crate::error::{AppError, AppResult};

pub struct Subscription {
    pub uri: String,
    pub qr_svg: String,
}

pub fn build(node: &NodeRecord) -> AppResult<Subscription> {
    let uri = match node.protocol {
        ProtocolId::VlessReality => build_vless_reality_uri(node)?,
        ProtocolId::Hysteria2 => build_hysteria2_uri(node)?,
    };

    let code = QrCode::new(uri.as_bytes()).map_err(|e| AppError::Other(e.to_string()))?;
    let qr_svg = code.render::<Color>().min_dimensions(256, 256).build();

    Ok(Subscription { uri, qr_svg })
}

fn build_vless_reality_uri(node: &NodeRecord) -> AppResult<String> {
    let params = &node.protocol_params;
    let uuid = required_string(params, "uuid")?;
    let public_key = required_string(params, "public_key")?;
    let short_id = required_string(params, "short_id")?;
    let port = required_u64(params, "port")?;
    let sni = required_string(params, "sni")?;
    let flow = optional_string(params, "flow").unwrap_or("xtls-rprx-vision");
    let spider_x =
        utf8_percent_encode(optional_string(params, "spider_x").unwrap_or("/"), NON_ALPHANUMERIC)
            .to_string();
    let name = utf8_percent_encode(&node.name, NON_ALPHANUMERIC).to_string();

    Ok(format!(
        "vless://{uuid}@{}:{port}?encryption=none&flow={flow}&security=reality&sni={sni}&fp=chrome&pbk={public_key}&sid={short_id}&spx={spider_x}&type=tcp#{name}",
        node.host
    ))
}

fn build_hysteria2_uri(node: &NodeRecord) -> AppResult<String> {
    let params = &node.protocol_params;
    let password =
        utf8_percent_encode(required_string(params, "password")?, NON_ALPHANUMERIC).to_string();
    let port = required_u64(params, "port")?;
    let sni = required_string(params, "sni")?;
    let name = utf8_percent_encode(&node.name, NON_ALPHANUMERIC).to_string();
    let insecure = if is_insecure_enabled(params) {
        "&insecure=1"
    } else {
        ""
    };

    Ok(format!(
        "hy2://{password}@{}:{port}?sni={sni}{insecure}#{name}",
        node.host
    ))
}

fn required_string<'a>(params: &'a serde_json::Value, key: &str) -> AppResult<&'a str> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Other(format!("missing or invalid protocol param: {key}")))
}

fn optional_string<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|v| v.as_str())
}

fn required_u64(params: &serde_json::Value, key: &str) -> AppResult<u64> {
    params
        .get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| AppError::Other(format!("missing or invalid protocol param: {key}")))
}

fn is_insecure_enabled(params: &serde_json::Value) -> bool {
    match params.get("insecure") {
        Some(value) if value.as_u64() == Some(1) => true,
        Some(value) if value.as_str() == Some("1") => true,
        Some(value) if value.as_bool() == Some(true) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::build;
    use crate::deploy::{NodeRecord, ProtocolId};

    #[test]
    fn test_vless_reality_uri() {
        let node = NodeRecord {
            id: "node-1".to_string(),
            vps_id: "vps-1".to_string(),
            vps_name: "Tokyo VPS".to_string(),
            name: "My Node".to_string(),
            host: "example.com".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::VlessReality,
            protocol_params: json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pubkey123",
                "short_id": "abcd",
                "port": 443,
                "sni": "cdn.example.com",
                "flow": "xtls-rprx-vision"
            }),
            status: "ready".to_string(),
            created_at: 1,
        };

        let subscription = build(&node).expect("build should succeed");
        assert_eq!(
            subscription.uri,
            "vless://123e4567-e89b-12d3-a456-426614174000@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=cdn.example.com&fp=chrome&pbk=pubkey123&sid=abcd&spx=%2F&type=tcp#My%20Node"
        );
    }

    #[test]
    fn test_hysteria2_uri_with_insecure() {
        let node = NodeRecord {
            id: "node-2".to_string(),
            vps_id: "vps-1".to_string(),
            vps_name: "Tokyo VPS".to_string(),
            name: "Node 2".to_string(),
            host: "hy.example.com".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::Hysteria2,
            protocol_params: json!({
                "password": "pass word",
                "port": 8443,
                "sni": "hy-sni.example.com",
                "insecure": 1
            }),
            status: "ready".to_string(),
            created_at: 2,
        };

        let subscription = build(&node).expect("build should succeed");
        assert!(subscription.uri.contains("&insecure=1"));
    }
}
