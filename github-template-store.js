(function () {
  'use strict';

  const repository = 'nadeldzx-glitch/price-calculator';
  const branch = 'main';
  const templatePath = 'shared-template.json';
  const repositoryAPI = 'https://api.github.com/repos/' + repository;
  const tokenKey = 'bh_github_template_token';

  function getToken() {
    return sessionStorage.getItem(tokenKey) || '';
  }

  function revision(template) {
    return template && !template._empty ? template._revision || template._publishedAt || null : null;
  }

  function encodeJSON(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
    if (bytes.length > 512 * 1024) throw new Error('模板数据过大，请减少自定义工序内容后重试');
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(chunks.join(''));
  }

  function decodeJSON(value) {
    const binary = atob(value.replace(/\s/g, ''));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
  }

  async function request(path, token, options = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      Authorization: 'Bearer ' + token
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(repositoryAPI + path, {
      ...options,
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok) {
      const messages = {
        401: 'GitHub 授权已失效，请重新登录',
        403: '此令牌没有当前仓库的写入权限，或请求暂时受限',
        404: '此令牌无法访问 price-calculator 仓库',
        409: '共享模板已被其他管理员更新，请同步后重新保存',
        422: 'GitHub 拒绝了本次提交，请检查仓库写入权限'
      };
      const error = new Error(messages[response.status] || 'GitHub 服务暂时不可用，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function signIn(value) {
    const token = value.trim();
    if (!token) throw new Error('请填写此仓库的 GitHub 访问令牌');
    await request('', token);
    // 用不关联任何分支的短文本对象检查 Contents 写入权限。
    await request('/git/blobs', token, {
      method: 'POST',
      body: JSON.stringify({ content: 'price-calculator template permission check\n', encoding: 'utf-8' })
    });
    sessionStorage.setItem(tokenKey, token);
    sessionStorage.setItem('role', 'admin');
    sessionStorage.removeItem('bh_pwd');
  }

  function signOut() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem('bh_pwd');
    sessionStorage.setItem('role', 'employee');
  }

  async function read() {
    const response = await fetch('./' + templatePath + '?_t=' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('共享模板暂时无法读取');
    return response.json();
  }

  async function publish(template, expectedRevision) {
    const token = getToken();
    if (!token || sessionStorage.getItem('role') !== 'admin') {
      throw new Error('请先使用有仓库写权限的 GitHub 令牌登录');
    }
    const path = '/contents/' + templatePath;
    const current = await request(path + '?ref=' + branch, token, { allowMissing: true });
    const latestTemplate = current ? decodeJSON(current.content) : null;
    if (revision(latestTemplate) !== (expectedRevision || null)) {
      const error = new Error('共享模板已有新版本，请先同步后重新保存');
      error.latestTemplate = latestTemplate;
      throw error;
    }
    const payload = {
      ...template,
      _publishedAt: new Date().toISOString(),
      _revision: crypto.randomUUID()
    };
    const body = {
      message: 'Update shared calculator template',
      branch,
      content: encodeJSON(payload)
    };
    if (current) body.sha = current.sha;
    await request(path, token, { method: 'PUT', body: JSON.stringify(body) });
    return payload;
  }

  window.githubTemplateStore = {
    signIn,
    signOut,
    read,
    publish,
    revision,
    isSignedIn: () => Boolean(getToken()) && sessionStorage.getItem('role') === 'admin'
  };
})();
