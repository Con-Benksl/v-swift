/**
 * 校验协议 SNI：仅接受与后端部署脚本一致的 ASCII DNS 名称。
 * 这只是前端即时反馈；后端仍会独立校验并逐参数转义远端 shell 命令。
 */
export function isValidSni(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || candidate.length > 253) return false;

  const labels = candidate.split('.');
  if (labels.length < 2) return false;

  return labels.every(
    (label) =>
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
  );
}

export const MAX_NODE_NAME_LENGTH = 80;

export function isValidNodeName(value: string): boolean {
  const name = value.trim();
  return name.length > 0 && Array.from(name).length <= MAX_NODE_NAME_LENGTH;
}
