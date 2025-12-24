/*!
 * Twikoo EdgeOne Pages Edge Function - KV 数据库操作层
 * (c) 2025-present Mntimate
 * Released under the MIT License.
 * 
 * 使用 EdgeOne Pages KV 存储作为数据库
 * KV 命名空间需要在 EdgeOne Pages 控制台绑定，变量名：TWIKOO_KV
 * 
 * 此 Edge Function 仅负责 KV 数据库操作，主要逻辑在 Node Function 中实现
 */

const VERSION = '1.6.44'

// 响应码
const RES_CODE = {
  SUCCESS: 0,
  FAIL: 1000,
  FORBIDDEN: 1403
}

/**
 * EdgeOne Pages Edge Function 入口
 */
export async function onRequest(context) {
  const { request } = context
  
  console.log('KV API 收到请求，method:', request.method)
  
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return handleCors(request)
  }
  
  // 只处理 POST 请求
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      code: RES_CODE.SUCCESS,
      message: 'Twikoo KV API 运行正常',
      version: VERSION
    }), {
      headers: getCorsHeaders(request)
    })
  }

  let res = {}
  
  try {
    // 验证内部调用
    const isInternal = request.headers.get('X-Twikoo-Internal') === 'true'
    if (!isInternal) {
      return new Response(JSON.stringify({
        code: RES_CODE.FORBIDDEN,
        message: '禁止直接访问 KV API'
      }), { headers: getCorsHeaders(request) })
    }

    const body = await request.json()
    const { action, data } = body
    
    console.log('KV 操作：', action)
    
    // 创建数据库操作对象
    const db = createKVDatabase()
    
    switch (action) {
      case 'getComments':
        res = { code: RES_CODE.SUCCESS, data: await db.getComments(data.query || {}) }
        break
      case 'addComment':
        res = { code: RES_CODE.SUCCESS, data: await db.addComment(data.comment) }
        break
      case 'updateComment':
        res = { code: RES_CODE.SUCCESS, data: await db.updateComment(data.id, data.updates) }
        break
      case 'deleteComment':
        res = { code: RES_CODE.SUCCESS, data: await db.deleteComment(data.id) }
        break
      case 'getComment':
        res = { code: RES_CODE.SUCCESS, data: await db.getComment(data.id) }
        break
      case 'bulkAddComments':
        res = { code: RES_CODE.SUCCESS, data: await db.bulkAddComments(data.comments) }
        break
      case 'getConfig':
        res = { code: RES_CODE.SUCCESS, data: await db.getConfig() }
        break
      case 'saveConfig':
        res = { code: RES_CODE.SUCCESS, data: await db.saveConfig(data.config) }
        break
      case 'getCounter':
        res = { code: RES_CODE.SUCCESS, data: await db.getCounter(data.url) }
        break
      case 'incCounter':
        res = { code: RES_CODE.SUCCESS, data: await db.incCounter(data.url, data.title) }
        break
      default:
        res = { code: RES_CODE.FAIL, message: '未知操作' }
    }
  } catch (e) {
    console.error('KV 操作错误：', e.message, e.stack)
    res = { code: RES_CODE.FAIL, message: `KV Error: ${e.message}` }
  }
  
  return new Response(JSON.stringify(res), {
    headers: getCorsHeaders(request)
  })
}

// ==================== CORS 处理 ====================

function handleCors(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  })
}

function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*'
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Twikoo-Internal',
    'Access-Control-Max-Age': '600'
  }
}

// ==================== 工具函数 ====================

function generateUUID() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, () => {
    return (Math.random() * 16 | 0).toString(16)
  })
}

// ==================== KV 数据库操作层 ====================

function createKVDatabase() {
  if (typeof TWIKOO_KV === 'undefined') {
    throw new Error('未配置 TWIKOO_KV 命名空间，请在 EdgeOne Pages 控制台绑定 KV 存储')
  }
  
  return {
    async getComments(query = {}) {
      const allComments = await this.getAllFromCollection('comment')
      return filterComments(allComments, query)
    },
    
    async addComment(comment) {
      const id = comment._id || generateUUID()
      comment._id = id
      await TWIKOO_KV.put(`comment:${id}`, JSON.stringify(comment))
      await this.addToIndex('comment', id)
      return { id }
    },
    
    async updateComment(id, updates) {
      const comment = await this.getComment(id)
      if (comment) {
        Object.assign(comment, updates)
        await TWIKOO_KV.put(`comment:${id}`, JSON.stringify(comment))
        return { updated: 1 }
      }
      return { updated: 0 }
    },
    
    async deleteComment(id) {
      await TWIKOO_KV.delete(`comment:${id}`)
      await this.removeFromIndex('comment', id)
      return { deleted: 1 }
    },
    
    async getComment(id) {
      const data = await TWIKOO_KV.get(`comment:${id}`)
      return data ? JSON.parse(data) : null
    },
    
    async bulkAddComments(comments) {
      let insertedCount = 0
      for (const comment of comments) {
        await this.addComment(comment)
        insertedCount++
      }
      return insertedCount
    },
    
    async getConfig() {
      const data = await TWIKOO_KV.get('config:main')
      return data ? JSON.parse(data) : {}
    },
    
    async saveConfig(newConfig) {
      const currentConfig = await this.getConfig()
      const merged = { ...currentConfig, ...newConfig }
      await TWIKOO_KV.put('config:main', JSON.stringify(merged))
      return { updated: 1 }
    },
    
    async getCounter(url) {
      const key = `counter:${encodeURIComponent(url)}`
      const data = await TWIKOO_KV.get(key)
      return data ? JSON.parse(data) : null
    },
    
    async incCounter(url, title) {
      const key = `counter:${encodeURIComponent(url)}`
      let counter = await this.getCounter(url)
      if (counter) {
        counter.time = (counter.time || 0) + 1
        counter.title = title
        counter.updated = Date.now()
      } else {
        counter = {
          url,
          title,
          time: 1,
          created: Date.now(),
          updated: Date.now()
        }
      }
      await TWIKOO_KV.put(key, JSON.stringify(counter))
      return 1
    },
    
    async getAllFromCollection(collection) {
      const indexKey = `index:${collection}`
      const indexData = await TWIKOO_KV.get(indexKey)
      const ids = indexData ? JSON.parse(indexData) : []
      
      const items = []
      for (const id of ids) {
        const data = await TWIKOO_KV.get(`${collection}:${id}`)
        if (data) {
          items.push(JSON.parse(data))
        }
      }
      return items
    },
    
    async addToIndex(collection, id) {
      const indexKey = `index:${collection}`
      const indexData = await TWIKOO_KV.get(indexKey)
      const ids = indexData ? JSON.parse(indexData) : []
      if (!ids.includes(id)) {
        ids.push(id)
        await TWIKOO_KV.put(indexKey, JSON.stringify(ids))
      }
    },
    
    async removeFromIndex(collection, id) {
      const indexKey = `index:${collection}`
      const indexData = await TWIKOO_KV.get(indexKey)
      const ids = indexData ? JSON.parse(indexData) : []
      const newIds = ids.filter(i => i !== id)
      await TWIKOO_KV.put(indexKey, JSON.stringify(newIds))
    }
  }
}

// 评论过滤函数
function filterComments(comments, query) {
  if (!Object.keys(query).length) return comments
  
  return comments.filter(comment => {
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        const orMatch = value.some(condition => {
          return Object.entries(condition).every(([k, v]) => matchCondition(comment, k, v))
        })
        if (!orMatch) return false
      } else if (!matchCondition(comment, key, value)) {
        return false
      }
    }
    return true
  })
}

function matchCondition(comment, key, value) {
  const commentValue = comment[key]
  
  if (value === null || value === undefined) {
    return commentValue === null || commentValue === undefined
  }
  
  if (typeof value === 'object') {
    if ('$in' in value) {
      return value.$in.includes(commentValue)
    }
    if ('$ne' in value) {
      return commentValue !== value.$ne
    }
    if ('$exists' in value) {
      return value.$exists ? (commentValue !== undefined && commentValue !== null && commentValue !== '') : (commentValue === undefined || commentValue === null || commentValue === '')
    }
    if ('$gt' in value) {
      return commentValue > value.$gt
    }
    if ('$lt' in value) {
      return commentValue < value.$lt
    }
    if ('$regex' in value) {
      const regex = new RegExp(value.$regex, value.$options || '')
      return regex.test(commentValue)
    }
  }
  
  return commentValue === value
}

export default { onRequest }
