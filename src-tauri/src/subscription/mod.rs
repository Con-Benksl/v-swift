use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use qrcode::{render::svg::Color, QrCode};

use crate::deploy::{NodeRecord, ProtocolId};
use crate::error::{AppError, AppResult};

const URI_COMPONENT_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

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
    let uuid = encode_userinfo(required_string(params, "uuid")?);
    let public_key = encode_query_value(required_string(params, "public_key")?);
    let short_id = encode_query_value(required_string(params, "short_id")?);
    let port = required_u64(params, "port")?;
    let sni = encode_query_value(required_string(params, "sni")?);
    let flow = encode_query_value(optional_string(params, "flow").unwrap_or("xtls-rprx-vision"));
    let spider_x = encode_query_value(optional_string(params, "spider_x").unwrap_or("/"));
    let name = encode_fragment(&node.name);
    let host = encode_host(&node.host);

    Ok(format!(
        "vless://{uuid}@{host}:{port}?encryption=none&flow={flow}&security=reality&sni={sni}&fp=chrome&pbk={public_key}&sid={short_id}&spx={spider_x}&type=tcp#{name}"
    ))
}

fn build_hysteria2_uri(node: &NodeRecord) -> AppResult<String> {
    let params = &node.protocol_params;
    let password = encode_userinfo(required_string(params, "password")?);
    let port = required_u64(params, "port")?;
    let sni = encode_query_value(required_string(params, "sni")?);
    let name = encode_fragment(&node.name);
    let host = encode_host(&node.host);
    let insecure = if is_insecure_enabled(params) {
        "&insecure=1"
    } else {
        ""
    };

    Ok(format!(
        "hy2://{password}@{host}:{port}?sni={sni}{insecure}#{name}"
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

fn encode_userinfo(value: &str) -> String {
    utf8_percent_encode(value, URI_COMPONENT_ENCODE_SET).to_string()
}

fn encode_host(value: &str) -> String {
    utf8_percent_encode(value, URI_COMPONENT_ENCODE_SET).to_string()
}

fn encode_query_value(value: &str) -> String {
    utf8_percent_encode(value, URI_COMPONENT_ENCODE_SET).to_string()
}

fn encode_fragment(value: &str) -> String {
    utf8_percent_encode(value, URI_COMPONENT_ENCODE_SET).to_string()
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
                "public_key": "pub_key-123",
                "short_id": "abcd1234",
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
            "vless://123e4567-e89b-12d3-a456-426614174000@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=cdn.example.com&fp=chrome&pbk=pub_key-123&sid=abcd1234&spx=%2F&type=tcp#My%20Node"
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
