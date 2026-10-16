import type { ReactNode } from 'react';

import { AppTabBar } from '@/components/app-tab-bar';

/* 登录后区域的公共外壳。
 *
 * 用「路由组」(app) 而不是给每页各写一遍导航：路由组不改变 URL
 * （(app)/dashboard 仍然访问 /dashboard），但可以共享一层 layout。
 * 这样以后加「我的食物」「设置」等页面，只要放进 (app)/ 就自动
 * 获得底部标签栏，不会出现「新页面忘了加导航」这种不一致。
 *
 * 为什么不做登录校验：layout 里做重定向会在**每次**子页面导航时
 * 都跑一遍，而且 layout 不重渲染的优化会让校验结果被缓存住 ——
 * 用户退出登录后仍能看到页面壳。校验放在各页面的 requireUser() 里，
 * 那里能拿到准确结果，也离数据更近。
 *
 * min-h-dvh + flex-col：内容不够长时把标签栏推到底部，
 * 而不是让它悬在屏幕中间。dvh 而不是 vh —— iOS Safari 的地址栏
 * 收起/展开时 vh 不变，会导致底部露出一截空白。 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="screen-min flex flex-col">
      <div className="flex-1">{children}</div>
      <AppTabBar />
    </div>
  );
}
