import type { MetadataRoute } from 'next';

/**
 * 这是个自己用的减脂记录工具，不是要给搜索引擎收录的产品。
 *
 * 为什么显式写 disallow 而不是什么都不做：
 * 不放 robots.ts 时，爬虫默认「什么都能爬」。健康数据页面虽然都要求登录、
 * 爬虫点进去只会拿到 307，但 /login 也会被收进索引 —— 将来你搜自己的项目名，
 * 出来的可能是一个登录页，而不是首页。
 *
 * 注意 robots.txt 是「君子协定」：它只能劝退守规矩的爬虫，不是访问控制。
 * 真正的边界是 RLS 和那四个 307。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
