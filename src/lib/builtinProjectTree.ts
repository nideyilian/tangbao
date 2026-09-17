/**
 * 内置的「产品线 - 产品 - 方向」三级项目结构（由《输出位置明细-独立版》整理）。
 *
 * 用途：首次启动时把这套骨架写入素材库「项目」文件夹树，并镜像到 SOP 管理的分组树。
 *
 * 约定：
 * - 节点 id 采用 `builtin-<层级>-<业务 id>` 的确定性形式（业务 id 取自明细表），
 *   重复执行时可靠地识别同一条目，不依赖名称是否被用户改写。
 * - 这里只描述结构骨架（不含渠道、共享盘目录等交付信息），渠道与输出路径由既有链路处理。
 * - 用户可自由改名 / 移动 / 删除内置文件夹；被删除后不会自动重建（见 builtinProjectTreeApply）。
 */

/** 内置节点 id 前缀，用于区分内置文件夹与用户自建文件夹。 */
export const BUILTIN_ID_PREFIX = 'builtin-'

export interface BuiltinProjectDirection {
  id: string
  name: string
}

export interface BuiltinProjectProduct {
  id: string
  name: string
  directions: BuiltinProjectDirection[]
}

export interface BuiltinProjectLine {
  id: string
  name: string
  products: BuiltinProjectProduct[]
}

/** 内置项目结构（产品线 → 产品 → 方向）。顺序即默认展示顺序。 */
export const BUILTIN_PROJECT_TREE: BuiltinProjectLine[] = [
  {
    id: 'builtin-line-6',
    name: '保险',
    products: [
      {
        id: 'builtin-product-7',
        name: '百万医疗险',
        directions: [
          { id: 'builtin-direction-9', name: '月亮' },
          { id: 'builtin-direction-17', name: '图标' },
          { id: 'builtin-direction-27', name: '插画' },
          { id: 'builtin-direction-67', name: '大字报' },
          { id: 'builtin-direction-76', name: '内容创意' },
        ],
      },
    ],
  },
  {
    id: 'builtin-line-7',
    name: 'APP-拉新',
    products: [
      {
        id: 'builtin-product-8',
        name: '快手',
        directions: [
          { id: 'builtin-direction-10', name: '网赚' },
          { id: 'builtin-direction-11', name: '萌宠' },
          { id: 'builtin-direction-12', name: '老歌' },
          { id: 'builtin-direction-13', name: '旅游' },
          { id: 'builtin-direction-14', name: '美食' },
          { id: 'builtin-direction-15', name: '短剧' },
          { id: 'builtin-direction-16', name: '一分购' },
          { id: 'builtin-direction-18', name: '官方样式' },
          { id: 'builtin-direction-63', name: '内容创意' },
          { id: 'builtin-direction-68', name: '购物' },
        ],
      },
      {
        id: 'builtin-product-10',
        name: '小红书',
        directions: [
          { id: 'builtin-direction-19', name: '美食' },
          { id: 'builtin-direction-20', name: '穿搭' },
          { id: 'builtin-direction-21', name: '美妆' },
          { id: 'builtin-direction-22', name: '头像' },
          { id: 'builtin-direction-23', name: '护肤' },
          { id: 'builtin-direction-24', name: '旅游' },
          { id: 'builtin-direction-25', name: '发型' },
          { id: 'builtin-direction-26', name: '美甲' },
        ],
      },
      {
        id: 'builtin-product-11',
        name: '百度网盘',
        directions: [{ id: 'builtin-direction-30', name: '常规' }],
      },
      {
        id: 'builtin-product-13',
        name: '移动APP',
        directions: [
          { id: 'builtin-direction-31', name: '签到有礼-100元话费+2G流量' },
          { id: 'builtin-direction-32', name: '签到有礼-10元话费+2G流量' },
        ],
      },
      {
        id: 'builtin-product-15',
        name: '百度',
        directions: [
          { id: 'builtin-direction-33', name: '网赚' },
          { id: 'builtin-direction-34', name: '旅游' },
          { id: 'builtin-direction-35', name: '美食' },
          { id: 'builtin-direction-36', name: '科普' },
          { id: 'builtin-direction-37', name: '追剧' },
          { id: 'builtin-direction-38', name: '小说' },
          { id: 'builtin-direction-39', name: '资讯' },
        ],
      },
      {
        id: 'builtin-product-16',
        name: '百度极速版',
        directions: [
          { id: 'builtin-direction-40', name: '网赚' },
          { id: 'builtin-direction-41', name: '旅游' },
          { id: 'builtin-direction-42', name: '美食' },
          { id: 'builtin-direction-43', name: '科普' },
          { id: 'builtin-direction-44', name: '追剧' },
          { id: 'builtin-direction-45', name: '小说' },
        ],
      },
      {
        id: 'builtin-product-17',
        name: '抖音商城',
        directions: [
          { id: 'builtin-direction-46', name: '0.01元' },
          { id: 'builtin-direction-73', name: '0.1元' },
        ],
      },
      {
        id: 'builtin-product-18',
        name: '喜番免费短剧',
        directions: [
          { id: 'builtin-direction-47', name: '漫剧' },
          { id: 'builtin-direction-48', name: '短剧' },
          { id: 'builtin-direction-49', name: '网赚' },
        ],
      },
      {
        id: 'builtin-product-19',
        name: '红果短剧',
        directions: [
          { id: 'builtin-direction-50', name: '漫剧' },
          { id: 'builtin-direction-51', name: '短剧' },
          { id: 'builtin-direction-52', name: '网赚' },
        ],
      },
      {
        id: 'builtin-product-21',
        name: '快手极速版',
        directions: [
          { id: 'builtin-direction-55', name: '网赚' },
          { id: 'builtin-direction-56', name: '萌宠' },
          { id: 'builtin-direction-57', name: '老歌' },
          { id: 'builtin-direction-58', name: '旅游' },
          { id: 'builtin-direction-59', name: '美食' },
          { id: 'builtin-direction-60', name: '短剧' },
          { id: 'builtin-direction-61', name: '一分购' },
          { id: 'builtin-direction-62', name: '官方样式' },
          { id: 'builtin-direction-65', name: '内容创意' },
          { id: 'builtin-direction-71', name: '购物' },
        ],
      },
      {
        id: 'builtin-product-24',
        name: '闲鱼',
        directions: [{ id: 'builtin-direction-80', name: '导买' }],
      },
    ],
  },
  {
    id: 'builtin-line-10',
    name: '卡券',
    products: [
      {
        id: 'builtin-product-20',
        name: 'QQ阅读-25元',
        directions: [
          { id: 'builtin-direction-53', name: '插画' },
          { id: 'builtin-direction-54', name: '萌宠' },
          { id: 'builtin-direction-77', name: '小程序诱导' },
        ],
      },
    ],
  },
]

/** 展平后的一级节点：parentId 为 null 表示产品线（树根）。 */
export interface BuiltinProjectNode {
  id: string
  name: string
  parentId: string | null
  depth: number
  order: number
}

/**
 * 按「产品线 → 产品 → 方向」顺序展平成可逐级落盘的节点列表。
 * 父节点总排在子节点之前，调用方单次顺序遍历即可建树。
 */
export function flattenBuiltinProjectTree(tree: BuiltinProjectLine[] = BUILTIN_PROJECT_TREE): BuiltinProjectNode[] {
  const nodes: BuiltinProjectNode[] = []
  tree.forEach((line, lineIndex) => {
    nodes.push({ id: line.id, name: line.name, parentId: null, depth: 0, order: lineIndex })
    line.products.forEach((product, productIndex) => {
      nodes.push({ id: product.id, name: product.name, parentId: line.id, depth: 1, order: productIndex })
      product.directions.forEach((direction, directionIndex) => {
        nodes.push({ id: direction.id, name: direction.name, parentId: product.id, depth: 2, order: directionIndex })
      })
    })
  })
  return nodes
}

/** 判断 id 是否属于内置结构（含被用户移动或改名的节点）。 */
export function isBuiltinProjectNodeId(id: string): boolean {
  return id.startsWith(BUILTIN_ID_PREFIX)
}
