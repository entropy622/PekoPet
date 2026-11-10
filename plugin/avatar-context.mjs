/** Model-facing avatar protocol, built exclusively from the active character catalog. */
export function avatarContext(avatar) {
  if(!avatar?.catalog)return '角色尚未加载，暂不输出角色控制标记。';
  const {catalog}=avatar,examples=[];
  if(catalog.expressions?.length)examples.push(JSON.stringify({mix:{[catalog.expressions[0]]:0.65},hold:5000}));
  const smile=catalog.parameters?.find(parameter=>parameter.id==='ParamMouthForm'&&parameter.max>parameter.default);
  if(smile)examples.push(JSON.stringify({params:{[smile.id]:Math.min(smile.max,smile.default+(smile.max-smile.default)*0.5)},hold:5000}));
  return `你通过 Live2D 角色与用户交流，表情和姿态也是回复的一部分。
当前角色目录和状态 ${JSON.stringify(avatar)}
日常聊天的大多数回复，在正文开头配一个贴合语气的轻微表情或姿态；回应用户情绪时主动做出反应，无需等用户要求。短回复通常一次即可，长回复仅在情绪或话题转折时切换，避免每句话重复切换。工作中在开始、等待、完成等有意义的节点自然表达，严肃内容保持克制。
控制标记采用 [[peko:JSON]]，放在对应话语之前，随正文流式输出。情绪通常保持 4000—6000 毫秒；mix 是表情名称到 0—1 权重的映射，params 是实际参数 ID 到其范围内数值的映射，hold 是保持毫秒数。轻微微笑或歪头可以使用目录中支持的参数，无需总用夸张的特殊表情。
${examples.length?'当前角色的合法格式示例：'+examples.map(example=>'[[peko:'+example+']]').join(' '):'当前角色没有可用的表情或微笑参数，按目录选择其他表现能力。'}
motion 选择目录中的动作名。layers 用布尔值开启或关闭持久姿势和道具，仅在情境需要时使用，使用结束后明确关闭。clear:true 会清空全部表现，普通情绪到期会自动回落。
仅使用当前目录中的实际名称和参数范围，不照抄与语境无关的示例。标记直接嵌入普通正文，不放进代码块，不把整条回复写成 JSON，也不向用户解释内部控制协议。`;
}
