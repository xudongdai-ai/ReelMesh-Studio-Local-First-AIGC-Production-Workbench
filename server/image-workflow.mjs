const FIELD_RULES = [
  ["婚礼事实", /婚礼真实资料|新人|新郎|新娘|婚期|相识与经历|重要片段|家人与朋友|风格方向|目标时长|必须保留|明确避开|照片说明/],
  ["人物", /人物|角色|主角|男主|女主|少年|少女|男人|女人|老人/],
  ["服装", /服装|穿着|衣着|造型|发型|妆容|佩戴|婚纱|西装|礼服|头纱/],
  ["场景", /场景|地点|环境|背景|室内|室外|街道|房间|宫殿|山林|城市|海边|婚礼|仪式|宴会厅|礼堂|教堂|草坪|婚宴/],
  ["道具", /道具|手持|拿着|携带|物件|武器|器物|戒指|捧花|请柬|婚车|蛋糕|香槟|喜糖|桌花/],
  ["群演", /群演|人群|路人|士兵|百姓|观众|宾客|亲友|伴郎|伴娘|家人/],
  ["动作", /动作|姿态|行为|正在|奔跑|站立|坐着|回头|抬手|凝视|交换戒指|拥抱|牵手|接吻|敬酒|入场|告白|迎宾|送客/],
  ["镜头", /镜头|景别|机位|构图|视角|运镜|焦段|画幅|婚礼摄影|婚礼纪录片|婚纱照/],
  ["光线", /光线|光影|照明|色调|氛围|雾|雨|雪|夜|清晨|黄昏|烛光|灯串|暖光/],
  ["风格", /风格|画风|质感|实拍|写实|动漫|水墨|商业|纪实婚礼|婚礼电影|婚纱摄影/],
  ["负面限制", /负面|不要|避免|禁止|不出现|排除/],
];

function clean(value) {
  return String(value || "").replace(/[：:]+$/, "").trim();
}

function cleanLine(value) {
  return clean(String(value || "").replace(/^[-*\s]+/, "").replace(/^\d+[、.)]\s*/, ""));
}

function splitRequest(request) {
  return String(request || "").split(/\n\s*(?:---+|###)\s*\n|\n\s*\n(?=第?\s*\d+[、.)])/).map((item) => item.trim()).filter(Boolean);
}

function collectFromLines(text) {
  const fields = Object.fromEntries(FIELD_RULES.map(([label]) => [label, []]));
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  for (const line of lines) {
    if (/^【[^】]+】$/.test(line)) continue;
    const separatorIndex = line.search(/[：:]/);
    const heading = separatorIndex >= 0 ? clean(line.slice(0, separatorIndex)) : line;
    const value = separatorIndex >= 0 ? clean(line.slice(separatorIndex + 1)) : line;
    const matched = FIELD_RULES.find(([, pattern]) => pattern.test(heading));
    if (matched) {
      const [label] = matched;
      if (value) {
        fields[label].push(value);
        if (label === "婚礼事实") {
          if (/新人|新郎|新娘/.test(heading)) fields["人物"].push(value);
          if (/家人与朋友/.test(heading)) fields["群演"].push(value);
          if (/风格方向/.test(heading)) fields["风格"].push(value);
          if (/明确避开|必须避免/.test(heading)) fields["负面限制"].push(value);
        }
      }
      continue;
    }
    const colon = line.match(/^([^：:]{1,8})[：:](.+)$/);
    if (colon) {
      const label = FIELD_RULES.find(([name]) => name === clean(colon[1]))?.[0];
      if (label) fields[label].push(clean(colon[2]));
    }
  }
  return fields;
}

function inferFields(text, fields, skill) {
  const source = String(text || "").trim();
  if (!source) return fields;
  const hasStructuredValue = Object.values(fields).some((items) => items.length);
  if (!hasStructuredValue) {
    const type = String(skill?.type || "image");
    if (type === "character") fields["人物"].push(source);
    else if (type === "scene") fields["场景"].push(source);
    else if (type === "costume") fields["服装"].push(source);
    else if (type === "prop") fields["道具"].push(source);
    else fields["场景"].push(source);
  }
  return fields;
}

function joinField(items) {
  return items.filter(Boolean).join("；");
}

export function compileImagePrompt({ request, skill, project, assetName, aspectRatio, approvedAssets = [], negativePrompt = "" }) {
  const text = String(request || "").trim();
  const fields = inferFields(text, collectFromLines(text), skill);
  const refs = approvedAssets.slice(0, 12).map((asset, index) => `@资产${String(index + 1).padStart(2, "0")}（${asset.typeLabel || asset.type}：${asset.name}，第${asset.version || 1}版）`).join("、");
  const lines = [
    `【主体与画面】${joinField(fields["人物"]) || "按本次真实需求确定主体"}`,
    `【服装与外观】${joinField(fields["服装"]) || "按本次真实需求保持外观连续"}`,
    `【场景与空间】${joinField(fields["场景"]) || "按本次真实需求确定空间"}`,
    `【道具与群演】${joinField([...fields["道具"], ...fields["群演"]]) || "无额外道具与群演"}`,
    `【动作与关系】${joinField(fields["动作"]) || "形成明确的动作或观看关系"}`,
    `【镜头与画幅】${joinField(fields["镜头"]) || `横向或竖向构图，输出画幅 ${aspectRatio || project?.aspectRatio || "16:9"}`}`,
    `【光线与氛围】${joinField(fields["光线"]) || "光线服务主体，保留空间层次"}`,
    `【视觉方向】${joinField(fields["风格"]) || project?.style || "遵循当前制作规范"}`,
  ];
  if (fields["婚礼事实"]?.length) lines.splice(1, 0, `【婚礼事实与隐私边界】${joinField(fields["婚礼事实"])}`);
  if (refs) lines.push(`【一致性资产】${refs}`);
  lines.push(`【制作规范】${skill?.name || "图片提示词导演"}；只使用本次输入，不补写未提供的剧情与人物关系。`);
  const extractedNegative = joinField(fields["负面限制"]);
  return {
    prompt: lines.join("\n"),
    negativePrompt: ["错手、错脸、畸形肢体、文字、水印、低清、主体被裁切、无关人物、风格跑偏", extractedNegative, String(negativePrompt || "").trim()].filter(Boolean).join("；"),
    extraction: Object.fromEntries(Object.entries(fields).filter(([, items]) => items.length).map(([label, items]) => [label, items])),
    source: text,
  };
}

export function compileImageWorkflow({ request, skill, project, assetName, aspectRatio, approvedAssets, negativePrompt }) {
  const requests = splitRequest(request);
  return {
    assetName: String(assetName || "").trim(),
    variants: requests.map((item, index) => ({
      index: index + 1,
      ...compileImagePrompt({ request: item, skill, project, assetName, aspectRatio, approvedAssets, negativePrompt }),
    })),
  };
}
