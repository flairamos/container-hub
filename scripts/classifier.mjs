import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CRAWL } from './config.mjs';
import { log, warn, sha256 } from './lib/util.mjs';
import { hostOf } from './lib/url.mjs';

/**
 * 三级分类：域名/品牌规则 → 关键词规则 → LLM 兜底。
 * 规则先跑，只有规则完全没命中时才可能调用 LLM。
 */

const BRAND_RULES = [
  { host: 'opencode.ai', category: 'coding-agent' },
  { host: 'cursor.com', category: 'coding-agent' },
  { host: 'windsurf.com', category: 'coding-agent' },
  { host: 'commandcode.ai', category: 'coding-agent' },
  { host: 'aider.chat', category: 'coding-agent' },
  { host: 'cline.bot', category: 'coding-agent' },
  { host: 'continue.dev', category: 'coding-agent' },
  { host: 'claude.com', path: '/product/claude-code', category: 'coding-agent' },
  { host: 'claude.ai', category: 'ai-tool' },
  { host: 'chatgpt.com', category: 'ai-tool' },
  { host: 'gemini.google.com', category: 'ai-tool' },
  { host: 'openrouter.ai', category: 'token-gateway' },
  { host: 'siliconflow.cn', category: 'token-gateway' },
  { host: 'openai.com', category: 'llm-provider' },
  { host: 'anthropic.com', category: 'llm-provider' },
  { host: 'deepseek.com', category: 'llm-provider' },
  { host: 'huggingface.co', category: 'llm-provider' },
  { host: 'perplexity.ai', category: 'ai-productivity' },
  { host: 'metaso.cn', category: 'ai-productivity' },
  { host: 'xiaohuanxiong.com', category: 'ai-productivity' },
  { host: 'aippt.cn', category: 'ai-writing' },
  { host: 'wawawriter.com', category: 'ai-writing' },
  { host: 'notion.so', path: '/product/ai', category: 'ai-writing' },
  { host: 'midjourney.com', category: 'ai-media' },
  { host: 'jimeng.jianying.com', category: 'ai-media' },
  { host: 'liblib.art', category: 'ai-media' },
  { host: 'klingai.com', category: 'ai-media' },
  { host: 'suno.com', category: 'ai-media' },
  { host: 'elevenlabs.io', category: 'ai-media' },
  { host: 'futurepedia.io', category: 'ai-directory' },
  { host: 'toolify.ai', category: 'ai-directory' },
  { host: 'theresanaiforthat.com', category: 'ai-directory' },
  { host: 'producthunt.com', category: 'ai-directory' },
  { host: 'mcp.so', category: 'agent-framework' },
  { host: 'smithery.ai', category: 'agent-framework' },
  { host: 'modelcontextprotocol.io', category: 'agent-framework' },
];

const RULES = [
  {
    category: 'learning',
    any: [
      'awesome-',
      'awesome ',
      'tutorial',
      'tutorials',
      'course',
      'courses',
      'handbook',
      'guide',
      'learning',
      'prompt engineering',
      '教程',
      '课程',
      '清单',
      '指南',
      '学习',
      '文档合集',
    ],
  },
  {
    category: 'coding-agent',
    any: [
      'opencode',
      'cursor',
      'claude code',
      'claude-code',
      'commandcode',
      'windsurf',
      'aider',
      'cline',
      'copilot',
      'codeium',
      'tabnine',
      'coding agent',
      'code agent',
      'coding assistant',
      'code assistant',
      'pair programmer',
      'pair programming',
      'code completion',
      'autocomplete',
      'ide',
      'terminal',
      '编码智能体',
      '编程助手',
      '代码补全',
      '结对编程',
      '终端',
    ],
  },
  {
    category: 'ai-directory',
    any: [
      'directory',
      'navigation',
      'navigate',
      'catalog',
      'catalogue',
      'tool finder',
      'tools list',
      '工具导航',
      '导航',
      '工具库',
      '工具目录',
      '收录',
      '榜单',
    ],
  },
  {
    category: 'token-gateway',
    any: [
      'openrouter',
      'siliconflow',
      'api gateway',
      'gateway',
      'inference api',
      'inference platform',
      'model api',
      'api 网关',
      'api 中转',
      '中转',
      '推理服务',
      '模型服务',
      '百炼',
      '方舟',
      'token 订阅',
      'token 计费',
    ],
  },
  {
    category: 'free-api',
    any: [
      'free llm',
      'free api',
      'free tier',
      'free-tier',
      'free trial',
      'free credits',
      'free models',
      '免费 api',
      '免费额度',
      '免费模型',
      '限时免费',
    ],
  },
  {
    category: 'ai-media',
    any: [
      'image generation',
      'image generator',
      'text-to-image',
      'video generation',
      'video generator',
      'text-to-video',
      'photo editor',
      'design tool',
      'graphic design',
      'music generation',
      'voice clone',
      'voice cloning',
      'text-to-speech',
      'ai art',
      'avatar',
      'image',
      'video',
      'photo',
      'design',
      'music',
      'audio',
      'voice',
      '绘画',
      '图像',
      '图片',
      '视频',
      '设计',
      '海报',
      '商品图',
      '抠图',
      '音频',
      '语音',
      '音乐',
      '剪辑',
      '数字人',
    ],
  },
  {
    category: 'ai-writing',
    any: [
      'writing',
      'writer',
      'copywriting',
      'copywriter',
      'content creation',
      'ppt',
      'slides',
      'presentation',
      'resume',
      'document',
      'translation',
      'translate',
      'paraphrase',
      'grammar',
      'proofreading',
      '写作',
      '文案',
      '小说',
      '文档',
      '简历',
      '翻译',
      '润色',
      '校对',
      '演示',
      'ppt',
    ],
  },
  {
    category: 'ai-productivity',
    any: [
      'office',
      'productivity',
      'meeting',
      'meetings',
      'note-taking',
      'notes',
      'search engine',
      'ai search',
      'browser extension',
      'automation',
      'workflow automation',
      '办公',
      '效率',
      '会议',
      '笔记',
      '搜索',
      '浏览器',
      '自动化',
    ],
  },
  {
    category: 'agent-framework',
    any: [
      'langchain',
      'llama-index',
      'llamaindex',
      'crewai',
      'autogen',
      'mcp',
      'model context protocol',
      'agent framework',
      'agentic framework',
      'multi-agent',
      'multi agent',
      'orchestration',
      'orchestrator',
      'workflow',
      'agents',
      'agent',
      '框架',
      '编排',
      '多智能体',
      '工作流',
    ],
  },
  {
    category: 'llm-provider',
    any: [
      'llm',
      'llms',
      'large language model',
      'language model',
      'foundation model',
      'gpt',
      'chatgpt',
      'claude',
      'gemini',
      'deepseek',
      'qwen',
      'kimi',
      'minimax',
      'glm',
      'mistral',
      'llama',
      'grok',
      'openai',
      'anthropic',
      'cohere',
      'microsoft ai',
      'meta ai',
      '大模型',
      '模型供应商',
      '模型官方',
    ],
  },
];

const CATEGORY_SET = new Set(CATEGORIES.map((category) => category.id));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesKeyword(text, keyword) {
  const normalized = keyword.toLowerCase();
  if (!normalized) return false;
  // 纯英文关键词要求词边界，避免 "ide" 命中 "guide"。
  if (/^[a-z0-9 .+/-]+$/i.test(normalized)) {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(normalized).replace(/\\ /g, '\\s+')}([^a-z0-9]|$)`,
      'i',
    );
    return pattern.test(text);
  }
  return text.includes(normalized);
}

export function ruleClassify(item) {
  const host = hostOf(item.url);
  const pathName = (() => {
    try {
      return new URL(item.url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();

  for (const brand of BRAND_RULES) {
    if (host !== brand.host) continue;
    if (brand.path && !pathName.includes(brand.path)) continue;
    return brand.category;
  }

  const text = `${item.url || ''} ${item.title || ''} ${item.description || ''} ${
    (item.tags || []).join(' ')
  }`.toLowerCase();

  for (const rule of RULES) {
    if (rule.any.some((keyword) => includesKeyword(text, keyword))) {
      return rule.category;
    }
  }

  if (includesKeyword(text, 'ai') || text.includes('人工智能') || text.includes('生成式')) {
    return 'ai-tool';
  }
  return null;
}

export function normalizeCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return CATEGORY_SET.has(category) ? category : null;
}

const PROMPT_VERSION = 1;

export class Classifier {
  constructor({ cachePath, apiKey, limit = CRAWL.llmLimit } = {}) {
    this.cachePath = cachePath;
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.limit = limit;
    this.calls = 0;
    this.cache = {};
    if (cachePath) {
      try {
        this.cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
  }

  cacheKey(url) {
    return sha256(`${PROMPT_VERSION}:${url}`);
  }

  getCached(url) {
    const entry = this.cache[this.cacheKey(url)];
    return entry && CATEGORY_SET.has(entry.category) ? entry.category : null;
  }

  setCached(url, category) {
    this.cache[this.cacheKey(url)] = {
      category,
      at: new Date().toISOString(),
    };
  }

  async classify(item) {
    const rule = ruleClassify(item);
    if (rule) return rule;

    const cached = this.getCached(item.url);
    if (cached) return cached;

    if (!this.apiKey || this.calls >= this.limit) return null;

    const category = await this.llmClassify(item);
    if (category) this.setCached(item.url, category);
    return category;
  }

  async llmClassify(item) {
    this.calls += 1;
    log('llm', `分类 ${item.url}（本次第 ${this.calls}/${this.limit} 次调用）`);

    const categoryList = CATEGORIES.map(
      (category) => `${category.id}（${category.name}：${category.description}）`,
    ).join('\n');
    const prompt = `你是 AI 网站导航的编辑。请把下面的网站归到唯一一个分类里。
可选分类：
${categoryList}

网站：${item.url}
标题：${item.title || ''}
描述：${item.description || ''}

只输出分类 ID，例如 coding-agent。不要输出解释、标点或代码块。`;

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 12,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const content = String(data?.choices?.[0]?.message?.content || '')
        .trim()
        .replace(/^```(?:json)?|```$/g, '')
        .trim();
      const direct = normalizeCategory(content);
      if (direct) return direct;
      const jsonMatch = /\{[\s\S]*\}/.exec(content);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const fromJson = normalizeCategory(parsed.category);
          if (fromJson) return fromJson;
        } catch {
          // fall through
        }
      }
      const tokens = content.toLowerCase().match(/[a-z][a-z-]+/g) || [];
      for (const token of tokens) {
        if (CATEGORY_SET.has(token)) return token;
      }
      warn('llm', `无法解析分类结果: ${content.slice(0, 80)}`);
      return null;
    } catch (error) {
      warn('llm', `分类失败: ${error.message}`);
      return null;
    }
  }

  save() {
    if (!this.cachePath) return;
    try {
      mkdirSync(path.dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, `${JSON.stringify(this.cache, null, 2)}\n`, 'utf8');
    } catch (error) {
      warn('llm', `缓存写入失败: ${error.message}`);
    }
  }
}
