const defaultHeaders = {
  'Content-Type': 'application/json',
};

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = payload?.error || payload?.message || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.data = payload;
    throw error;
  }

  return payload;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { ...defaultHeaders, ...(options.headers || {}) },
  });
  return parseResponse(response);
}

function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function entityApi(entity) {
  return {
    list(sort, limit) {
      return request(`/api/entities/${entity}${queryString({ sort, limit })}`);
    },

    filter(criteria = {}, sort, limit) {
      return request(`/api/entities/${entity}/filter`, {
        method: 'POST',
        body: JSON.stringify({ criteria, sort, limit }),
      });
    },

    create(data) {
      return request(`/api/entities/${entity}`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      });
    },

    update(id, data) {
      return request(`/api/entities/${entity}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data || {}),
      });
    },

    delete(id) {
      return request(`/api/entities/${entity}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
  };
}

export const api = {
  entities: new Proxy({}, {
    get(target, entity) {
      if (typeof entity !== 'string') return target[entity];
      if (!target[entity]) target[entity] = entityApi(entity);
      return target[entity];
    },
  }),

  auth: {
    me() {
      return request('/api/auth/me');
    },

    login(email, password) {
      return request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },

    async logout() {
      await request('/api/auth/logout', { method: 'POST' }).catch(() => null);
      window.location.href = '/';
    },

    redirectToLogin() {
      window.location.href = '/';
    },
  },

  users: {
    inviteUser(email, role = 'client') {
      return request('/api/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
    },
  },

  integrations: {
    Core: {
      UploadFile({ file }) {
        const form = new FormData();
        form.append('file', file);
        return request('/api/integrations/upload-file', {
          method: 'POST',
          body: form,
        });
      },

      InvokeLLM(params) {
        return request('/api/integrations/invoke-llm', {
          method: 'POST',
          body: JSON.stringify(params || {}),
        });
      },
    },
  },
};
