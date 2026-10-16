/* 设置页表单的状态类型与初值。
 *
 * 为什么单独一个文件：`actions.ts` 顶上写着 'use server'，而 Next 规定
 * 这种文件【只能导出 async 函数】。把 SETTINGS_INITIAL 这个对象留在那里，
 * 会出现一个很坑的现象：页面 GET 正常、构建通过、类型检查通过，
 * 但用户一提交就 500 —— 报
 *   Error: A "use server" file can only export async functions, found object.
 * 详见 src/app/login/state.ts 里那段更长的说明。
 *
 * 这个坑在本项目里真的踩过一次（登录功能整体不可用），所以现在
 * tests/verify-server-actions.mjs 会把所有 'use server' 文件的顶层导出
 * 扫一遍，在 npm run verify 里拦下来。 */
export type SettingsState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
};

export const SETTINGS_INITIAL: SettingsState = { status: 'idle', message: '' };
