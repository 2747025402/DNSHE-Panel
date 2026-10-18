/** 仅显式复用仓库外、绑定目标 origin 的会话；从不保存或打印会话。 */
import fs from 'node:fs';
import path from 'node:path';

export function readReviewSession(repo, origin, filename = process.env.REVIEW_SESSION_FILE) {
  if (!filename) return '';
  try {
    const resolved = fs.realpathSync(path.resolve(filename));
    const relative = path.relative(fs.realpathSync(repo), resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error('inside-repository');
    }
    const saved = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (saved.origin !== origin || typeof saved.session_token !== 'string' || !/^dnshe_sess_[a-zA-Z0-9-]+$/.test(saved.session_token)) {
      throw new Error('invalid-origin-or-session');
    }
    return saved.session_token;
  } catch {
    throw new Error('无法安全读取仓库外目标会话；文件需为 {origin, session_token}，正文已隐藏。');
  }
}

export async function validateReviewSession(request, origin, token) {
  if (!token) return false;
  let response;
  try {
    response = await request.get(`${origin}/api/auth/account`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json', 'accept-encoding': 'identity' },
      timeout: 45_000, maxRedirects: 0, maxRetries: 0,
    });
    if ([401, 403].includes(response.status())) return false;
    if (response.status() !== 200) throw new Error('unexpected-status');
    const body = await response.json();
    if (body?.success !== true || typeof body.username !== 'string') throw new Error('unexpected-identity');
    return true;
  } catch {
    // 网络/协议失败不能当作过期并触发新登录，避免验收重试制造审计。
    throw new Error('已有会话的只读身份校验失败；未回退登录，响应与凭据已隐藏。');
  } finally { await response?.dispose(); }
}
