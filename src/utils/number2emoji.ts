const emojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
/**
 * 在 github 的 actions 用户填入的 Secrets 中，账号及密码信息一般都会包含数字
 * 因为github的安全策略原因，打印输出的log与Secrets中填入的信息部分相同时，会替换为 *** 导致数字的log无法正常显示
 * 此方法将数字替换为Emoji表情解决上述问题
 */
export const number2emoji = (number: number) => {
    return String(number).split('').map(i => emojis[Number(i)]).join('');
};
