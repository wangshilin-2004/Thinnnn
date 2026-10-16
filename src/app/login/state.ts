/* 登录表单的状态类型与初值。
 *
 * 为什么单独一个文件：`actions.ts` 顶上写着 'use server'，而 Next 规定
 * 这种文件【只能导出 async 函数】。把 LOGIN_INITIAL 这个对象留在那里，
 * 会出现一个很坑的现象：
 *
 *   - 页面 GET 正常渲染 200（渲染不加载 actions 模块）
 *   - 构建也通过（构建不执行 actions 模块）
 *   - 但用户一点「发登录链接」就 500：
 *       Error: A "use server" file can only export async functions, found object.
 *
 * 也就是说，首屏、构建、类型检查三条防线全都拦不住它，只有真的提交表单才会暴露。
 * 代价是「登录功能整体不可用」——对一个已部署的站点来说就是废站。
 *
 * 类型也一并搬过来，让 actions.ts 保持「只导出 async 函数」这一条纪律，
 * 以后加东西时不用每次重新判断边界在哪。 */
export type LoginState = {
  status: 'idle' | 'sent' | 'error';
  message: string;
};

export const LOGIN_INITIAL: LoginState = { status: 'idle', message: '' };
