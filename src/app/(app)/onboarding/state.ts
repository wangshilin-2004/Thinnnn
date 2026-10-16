/* 引导表单的状态类型与初值。
 *
 * 与 src/app/login/state.ts 是同一个原因：`actions.ts` 是 'use server' 文件，
 * 只允许导出 async 函数。ONBOARDING_INITIAL 这个对象留在那里会让
 * 「保存目标」按钮一按就 500，而页面本身、构建、类型检查全都是绿的。
 *
 * 类型一并搬出来，保持 actions.ts 只有 async 函数。 */
export type OnboardingState = { status: 'idle' | 'error'; message: string };

export const ONBOARDING_INITIAL: OnboardingState = { status: 'idle', message: '' };
