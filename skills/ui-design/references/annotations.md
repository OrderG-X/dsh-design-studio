# 业务标注（annotations.json）

只有技能里出现「业务标注」那一节时才写这个文件。内容用用户的语言。

## 放哪、什么格式

设计目录里的 `annotations.json`，和 `tokens.css` 并排。整个文件是一个对象，也可以直接是数组：

```json
{
  "annotations": [
    {
      "id": "room-03",
      "page": "room.html",
      "type": "rule",
      "title": "价格含双人早餐",
      "detail": "底栏价格是含早价；退订规则见确认订单页。",
      "selector": ".ab-price",
      "anchorLabel": "底栏价格",
      "fallbackText": "含双人早餐",
      "source": "PRD 2.6",
      "tags": ["价格"],
      "related": ["booking-02"],
      "status": "open"
    }
  ]
}
```

| 字段 | 必填 | 怎么写 |
|---|---|---|
| `id` | 是 | 整份文件不重复，稳定不变。用 `屏名-序号`，比如 `room-03`。中间插一条也别给后面的改号 |
| `page` | 是 | 这一屏的文件名，比如 `room.html` |
| `title` | 是 | 一句话说清这条规则 |
| `type` | 否 | `rule` 业务规则、`state` 状态边界、`logic` 逻辑、`flow` 流程、`metric` 口径 |
| `detail` | 否 | 正文。可以用换行、`**加粗**`、`` `行内代码` ``、`- ` 列表，别的不认 |
| `selector` | 否 | 这条对应页面上哪个元素，CSS 选择器 |
| `anchorLabel` | 否 | 这个区域叫什么，给人看的，比如「底栏价格」 |
| `fallbackText` | 否 | 这个元素上看得见的字。选择器失效时按它找 |
| `source` | 否 | 出处，只写真有的，比如 `PRD 2.6` |
| `tags` | 否 | 字符串数组 |
| `related` | 否 | 相关标注的 `id` |
| `status` | 否 | 拿不准、或和需求文档冲突：写 `open`，表示待确认 |

`selector` 和 `fallbackText` 都不写，就是这一屏整体的说明。

## 写什么

- 写界面上看不出来的东西：计算规则、状态怎么变、边界情况、出错和空状态、权限、数据口径。
- 每屏 3–8 条，挑开发最容易做错的。不复述页面上的字，不写「点击按钮提交订单」这种。
- 用户给了 PRD 或需求文件：先读，照它写，`source` 记到章节或编号。
- 没给需求文档：可以按设计里定下的规则写，`source` 留空，别编编号。

## 选择器

- 用你自己写的语义类名或 id，比如 `.ab-price`、`#agree-btn`。给要标的元素加上类名就行。
- 别用 `div > div:nth-child(3)` 这种，改版就失效。
- 要能只匹配到一个元素。列表里的就写第一项，比如 `.room-card:first-child .price`。
- 写法不合法、找不到，`check_design` 的结果末尾会列出来，顺手改。

## 改的时候

- 改了设计，同步改对应的标注：元素删了就删这条，类名改了就改 `selector`，规则变了就改 `title` 和 `detail`。
- 用户说「room-03 改成…」，只改 `id` 对得上的那条。
