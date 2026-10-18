/* 好友 / 用户名的纯函数与文案。
 *
 * 单独一个文件而不是塞进 actions.ts 的原因：actions.ts 顶上有 'use server'，
 * 那里面的每个导出都必须是 async 函数，纯函数和常量放不进去；
 * 而这些字符串又同时被服务端 action 和页面用到，放这里两边都能读。
 */

/** 用户名的形状，必须和迁移 0010 里的 CHECK 约束逐字一致。
 *  两处不一致的后果不是报错，而是「界面说能过、数据库说不行」——
 *  用户看到的是「保存失败，稍后再试」，然后永远试不成。 */
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export const USERNAME_HINT = '3–20 位，小写字母开头，只能用小写字母、数字和下划线';

/** 把用户输入整理成可以入库的形状。
 *  - 去掉首尾空白
 *  - 去掉开头的 @（人们习惯在社交软件里写 @someone）
 *  - 转小写（数据库里存的全是小写，不然 @ShiLin 和 @shilin 会变成两个人） */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** 校验用户名，返回一句中文错误；合法返回 null。 */
export function usernameError(raw: string): string | null {
  const value = normalizeUsername(raw);
  if (value.length === 0) return '给用户名起个名字吧。';
  if (value.length < 3) return '太短了，至少要 3 个字符。';
  if (value.length > 20) return '太长了，最多 20 个字符。';
  if (!USERNAME_RE.test(value)) return `格式不对：${USERNAME_HINT}`;
  return null;
}

export const LINK_STATUS_TEXT: Record<'pending' | 'accepted' | 'declined', string> = {
  pending: '等待确认',
  accepted: '好友',
  declined: '已拒绝',
};

/** 好友页顶部的提示条。用查询参数传递结果而不是客户端状态：
 *  这些表单都是纯服务端 action + redirect，整页刷新之后状态不丢，
 *  也不需要为了三行提示引入客户端组件。 */
export function friendNotice(code: string | undefined): { tone: 'ok' | 'error'; text: string } | null {
  switch (code) {
    case 'username':
      return { tone: 'ok', text: '用户名改好了。把这个名字告诉朋友，他就能找到你。' };
    case 'request':
      return { tone: 'ok', text: '申请发过去了，等对方确认。' };
    case 'accept':
      return { tone: 'ok', text: '已经加上了，你们现在能互相看到记录。' };
    case 'decline':
      return { tone: 'ok', text: '拒绝了这条申请。' };
    case 'remove':
      return { tone: 'ok', text: '好友已经删掉，互相看不到了。' };
    case 'shares':
      return { tone: 'ok', text: '共享设置已保存。' };
    case 'self':
      return { tone: 'error', text: '那是你自己。' };
    case 'notfound':
      return { tone: 'error', text: '没找到这个用户名。确认一下有没有打错？' };
    case 'exists':
      return { tone: 'error', text: '你们已经是好友了。' };
    case 'pending':
      return { tone: 'error', text: '已经有一条申请在等对方处理了，别催。' };
    case 'username_taken':
      return { tone: 'error', text: '这个名字被占用了，换一个吧。' };
    case 'username_bad':
      return { tone: 'error', text: `用户名不合规：${USERNAME_HINT}` };
    default:
      return null;
  }
}
