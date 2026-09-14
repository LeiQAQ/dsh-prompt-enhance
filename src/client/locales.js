/**
 * The composer seat's copy, in both shipped locales.
 *
 * Keys are flat and grouped by surface. The error sentences are the part that
 * matters: each one answers "was my draft touched?" explicitly, because the
 * whole failure contract of the feature is "the original text survives". A
 * failure whose cause is an unusable model (PRD §7.4) must read as a model
 * problem, not as a broken button.
 *
 * @module dsh-prompt-enhance/client/locales
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'enhance.tooltip': '增强提示词',
  'enhance.tooltip.busy': '正在增强提示词… 点击取消',
  'enhance.tooltip.failed': '上次没成功，点一下再试',
  'enhance.tooltip.disabled': '先写点内容再增强',
  'enhance.aria': '增强提示词',
  'enhance.aria.busy': '正在增强提示词，按下取消',
  'enhance.aria.failed': '增强提示词失败，按下重试',
  'enhance.revert': '恢复原文',
  'enhance.revert.aria': '恢复增强前的原文',

  'enhance.error.empty_input': '输入框里还没有内容',
  'enhance.error.too_long': '草稿太长了，上限 {limit} 个字符',
  'enhance.error.bad_encoding': '草稿传输失败，重新点一次试试',
  'enhance.error.no_model': '这个会话还没有可用的模型。先发一条消息，或在设置里选一个模型',
  'enhance.error.llm_error': '模型调用失败，多半是模型不可用或网络问题。原文没动',
  'enhance.error.timeout': '等太久了，已经中止。原文没动',
  'enhance.error.output_empty': '模型没返回可用内容。原文没动',
  'enhance.error.transport': '和后台通信失败。原文没动',
  'enhance.error.no_command': '没找到增强命令，插件可能没装好',
  'enhance.error.internal': '出了个意外错误。原文没动',
  'enhance.error.unknown': '增强失败。原文没动',
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'enhance.tooltip': 'Enhance prompt',
  'enhance.tooltip.busy': 'Enhancing… click to cancel',
  'enhance.tooltip.failed': 'That attempt failed — click to retry',
  'enhance.tooltip.disabled': 'Write something first',
  'enhance.aria': 'Enhance prompt',
  'enhance.aria.busy': 'Enhancing prompt, press to cancel',
  'enhance.aria.failed': 'Prompt enhancement failed, press to retry',
  'enhance.revert': 'Restore original',
  'enhance.revert.aria': 'Restore the text from before the enhancement',

  'enhance.error.empty_input': 'The composer is empty',
  'enhance.error.too_long': 'That draft is too long — the limit is {limit} characters',
  'enhance.error.bad_encoding': 'The draft could not be transferred. Click again',
  'enhance.error.no_model': 'This session has no model yet. Send a message first, or pick a model in settings',
  'enhance.error.llm_error': 'The model call failed — usually an unavailable model or a network problem. Your text is untouched',
  'enhance.error.timeout': 'That took too long, so it was stopped. Your text is untouched',
  'enhance.error.output_empty': 'The model returned nothing usable. Your text is untouched',
  'enhance.error.transport': 'Could not reach the background process. Your text is untouched',
  'enhance.error.no_command': 'The enhance command was not found — the plugin may not be installed',
  'enhance.error.internal': 'Something unexpected broke. Your text is untouched',
  'enhance.error.unknown': 'Enhancement failed. Your text is untouched',
}
