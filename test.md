**智能体互联互通接⼝⽅案**

# ⼀、智能体互联互通流程

## 1. 智能体服务登记注册

![image](index_files/498cf2bb753dc6213cdcdb68f7afe290e5e3cff0c37e509836c3ce5442eb2f0d-17793495524261.jpg)

## 2. 智能体服务发现及调⽤

### 2.1 ⽤户直连智能体

⽤户可能通过web⻚⾯、智能体商城配置等⽅式访问智能体A的服务，⽽智能体A内置了通过区域/⾏业节点动态发现MCP⼯具或智能体的能⼒

![image](index_files/f1b0b66cb611074fd2b73929ce45b4cdb4680efc3e279bce2c8d2b83335823af-17793495571343.jpg)

在⽤户直连智能体的情况下，⽤户的主体身份信息⽆法安全被智能体使⽤，因此我们引⼊了⽤户通过客户端连接智能体的模式，将⽤户的主体身份授权给智能体来使⽤，并通过客户端控制。

### 2.2 ⽤户通过客户端连接智能体

在这种情况下，⽤户可以通过客户端来动态发现并加载对应的智能体服务，流程如下：

![image](index_files/3dae9399fcbf314526c450d1bd12243a7e60326d61c0a413b117ed91e3c9afab-17793495853375.jpg)

加载完成后，智能体服务在有需要使⽤⽤户主体身份进⾏⼀些操作时，会给⽤户发起授权确认，有以下两种⽅式：

#### 2.2.1 客户端逐个执⾏调⽤

在这种情况下，智能体A需要以⽤户主体身份调⽤智能体B时，都需要由⽤户进⾏批准确认，⽽后由⽤户客户端发起调⽤，将结果返回给智能体A进⾏分析处理，返回最终结果。

![image](index_files/4f7227e1b41e6298ffeeec6b18d58770b80d03e0f50a50d5a43e83d45ebe6df3-17793495884357.jpg)

#### 2.2.2 客户端授权智能体调⽤

在这种情况下，智能体A需要以⽤户主体身份调⽤智能体B时，会通过⽤户进⾏批准确认，双⽅将针对本次需求的内容、双⽅信息、调⽤限制进⾏双签授权，由智能体A全权发起调⽤，各智能体将结果直接返回给智能体A进⾏分析处理，返回最终结果。授权的细节流程参考授权接⼝内说明。

![image](index_files/d8565cceb8b50f6cbb77c9427fabcb07edb4c9f924d523dbb2036f7e9ea47fef-17793495932009.jpg)

# ⼆、智能体互联互通接⼝

## 1. 挑战应答

参考全域/区域/业务节点身份挑战接⼝，⽤于：

1. 客户端访问区域节点进⾏智能体服务发现前的身份认证

2. 客户端与智能体服务交互前的身份认证

3. 智能体、MCP等智能体服务交互前的身份认证

## 2. 授权请求

授权流程

![image](index_files/e9864a7435bbe08f94b264d86991a0af2601a039aad63c4f432ab4402e3eca43-177934959623711.jpg)

**接⼝说明**

在完成身份挑战应答后，如果智能体A需要使⽤⽤户的身份进⾏跨智能体调⽤，需要由⽤户和发起智能体进⾏双签授权，流程如下：

1. 智能体确认需要使⽤⽤户的主体信息等授权，将授权相应的信息进⾏签名，并通过客户端的证书进⾏加密，获得加密⽂本，对应的明⽂参数标准化展示如下

```json
"AuthorizationInfo": {
    "AuthorizationMsg": {
    "PurposeText": "授权操作明文",
    "ExpirationTime": "超时时间",
    "Authorizer": "授权用户标识",
    "AuthorizedUser": "被授权智能体标识",
    "AuthorizationScope": ["授权字典"]
    },
    "AuthorizedSign": "被授权智能体签名"
}
```

2. 客户端使⽤私钥解密加密⽂本后，对被授权智能体签名进⾏校验，由⽤户对明⽂进⾏授权，授权成功后，客户端使⽤⽤户身份的私钥对明⽂及智能体的签名进⾏签名，并通过智能体的证书进⾏加密，获得加密⽂本，对应的明⽂参数标准化展示如下

```txt
√ 复制代码
"AuthorizationInfo": {
```

```txt
"AuthorizationMsg": {
    "PurposeText": "授权操作明文",
    "ExpirationTime": "超时时间",
    "Authorizer": "授权用户标识",
    "AuthorizedUser": "被授权智能体标识",
    "AuthorizationScope": ["授权字典"]
},
"AuthorizedSign": "被授权智能体签名",
"AuthorizerSign": "授权用户签名"
```

3. 【拓展⽅案操作】客户端将对应的授权信息发送给业务/区域节点/区块链合约，进⾏授权登记

4. 客户端将对应的授权信息发送给智能体A

5. 智能体A获取加密⽂本后，使⽤⾃⼰的私钥解密，确认⽤户授权的签名⽆误

6. 【拓展⽅案操作】智能体A确认授权成⽴

7. 智能体A携带授权信息向新的智能体B发起请求

8. 智能体B获取到授权信息后，逐个验证两个签名，确认超时时间⽆误

9. 【拓展⽅案操作】智能体B通过授权登记的地址、标识或合约，确认递归调⽤深度和token消耗符合要求

10.智能体B提供相应服务

11.【拓展⽅案操作】智能体B完成服务提供后，智能体A更新调⽤深度、token消耗记录等信息

**请求路径**

略

**请求⽅法**

略

请求核⼼参数

| 参数名            | 类型   | 是否必填 | 描述     | 示例     |
| ----------------- | ------ | -------- | -------- | -------- |
| AuthorizationInfo | object | 是       | 授权信息 | 参照上文 |

**响应核⼼参数**

| 参数名            | 类型   | 是否必填 | 描述     | 示例     |
| ----------------- | ------ | -------- | -------- | -------- |
| AuthorizationInfo | object | 是       | 授权信息 | 参照上文 |

## 3. 智能体服务登记

请求路径

略

请求⽅法

略

请求核⼼参数

| 参数名                                              | 类型          | 是否必填                                         | 描述                                                                          | 示例                                                      |
| --------------------------------------------------- | ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| 基础信息字段                                        |               |                                                  |                                                                               |                                                           |
| name                                                | string        | 是                                               | 服务的名称,用于显示和识别                                                     | "天气查                                                   |
| type                                                | enum          | 是                                               | 服务类型:"mcp"或"agent"                                                       | "mcp"                                                     |
| version                                             | string        | 是                                               | 服务版本号,遵循语义化版本规范                                                 | "1.2.3"                                                   |
| 业务信息字段                                        |               |                                                  |                                                                               |                                                           |
| serverModel                                         | enum          | 是                                               | 服务提供模式1:用户直连 2:服务直连                                             | 1. 用户问2. 只有问                                        |
| ndiType                                             | enum          | 是                                               | 调用模式多选:1:动态调用 2:常态固定调用 3:被调用                               |                                                           |
| deliveryType                                        | enum          | 是                                               | 交付模式1:根据地址交付2:本地部署交付                                          | 当delivEPLOYMENT交付)时onfig选                            |
| 描述信息                                            |               |                                                  |                                                                               |                                                           |
| description                                         | string        | 是                                               | 服务的简要描述                                                                | "提供全球能,支持纬度等多"提供北京关接口能产品上架身份解析 |
| keywords                                            | array[string] | 否                                               | 关键词数组,用于全文搜索和语义匹配                                             | ["weather"temper"forecas["北京","上海",                   |
| category                                            | string        | 否                                               | 服务分类                                                                      | "工具类"                                                  |
| subcategories                                       | array[string] | 否                                               | 子分类数组,用于更细粒度的分类                                                 | ["天气查                                                  |
| useCases                                            | array[string] | 否                                               | 使用场景描述,帮助LLM理解何时使用该服务                                        | ["查询当天气预报"                                         |
| icon                                                | string(URL)   | 否                                               | 服务图标URL                                                                   | "https:/om/icon"                                          |
| documentURL                                         | string(URL)   | 否                                               | 智能体AgentCard或mcp描述文档链接                                              |                                                           |
| MCP根据地址交付配置                                 |               | 当type=mcp且deliveryType=ADDRESS_BASED时必填     |                                                                               |                                                           |
| connectionConfig                                    | object        | 是                                               | 连接配置对象,根据type字段不同结构不同                                         | 见下方详                                                  |
| connectionConfig.mcp                                | object        | 否                                               | MCP连接配置(当type为mcp时必填)                                                | 见下方详                                                  |
| connectionConfig.mcp.transport                      | enum          | 是                                               | MCP传输方式:"stdio"、"sse"、"streamable Http"                                 | "sse"                                                     |
| connectionConfig.mcp.command                        | string        | 否                                               | 启动命令(当transport为stdio时必填)                                            | "node"                                                    |
| connectionConfig.mcp.args                           | array[string] | 否                                               | 命令参数(当transport为stdio时)                                                | [/path/tserver.js                                         |
| connectionConfig.mcp.env                            | object        | 否                                               | 环境变量(当transport为stdio时)                                                | {"API_KI"                                                 |
| connectionConfig.mcp.endpoint                       | string (URL)  | 否                                               | 连接端点URL(当transport为sse或websocket时必填)                                | "https://m/mcp/                                           |
| connectionConfig.mcp.initOptions                    | object        | 否                                               | MCP初始化选项                                                                 | {"server1"weather                                         |
| Agent根据地址交付配置                               |               | 当type=agent且deliveryType=ADDRESS_BASED时是必填 |                                                                               |                                                           |
| connectionConfig.agent                              | object        | 否                                               | Agent连接配置(当type为agent时必填)                                            | 见下方详                                                  |
| connectionConfig.agent.protocol                     | enum          | 是                                               | 通信协议:"http/https"、"websocket"                                            | "https"                                                   |
| connectionConfig.agent.endpoint                     | string (URL)  | 是                                               | Agent服务端点URL                                                              | "https://m/v1/ag                                          |
| connectionConfig.agent.method                       | enum          | 否                                               | HTTP方法(当protocol为http/https时): "GET"、"POST"、"PUT"、"DELETE",默认"POST" | "POST"                                                    |
| connectionConfig.agent.basePath                     | string        | 否                                               | API基础路径                                                                   | "/v1"                                                     |
| connectionConfig.agent.timeout                      | number        | 否                                               | 请求超时时间(毫秒),默认30000                                                  | 30000                                                     |
| connectionConfig.agent.streaming                    | object        | 否                                               | 流式传输配置                                                                  | 见下方详                                                  |
| connectionConfig.agent.streaming.supported          | boolean       | 否                                               | 是否支持流式传输,默认false                                                    | true                                                      |
| connectionConfig.agent.streaming.type               | enum          | 否                                               | 流式传输类型:"sse"、"websocket"、"chunked",当supported为true时必填            | "sse"                                                     |
| connectionConfig.agent.streaming.endpoint           | string (URL)  | 否                                               | 流式传输端点URL                                                               | "https://m/v1/ag                                          |
| connectionConfig.agent.streaming.format             | enum          | 否                                               | 流式数据格式:"json"、"text"、"ndjson",默认"ndjson"                            | "ndjson"                                                  |
| 身份认证                                            |               |                                                  |                                                                               |                                                           |
| authentication                                      | object        | 是                                               | 认证配置                                                                      | 见下方详                                                  |
| authentication.authUrl                              | string        | 是                                               | 身份认证时挑战应答对应的地址                                                  |                                                           |
| authentication.required                             | boolean       | 否                                               | 是否必须认证,默认true                                                         | true                                                      |
| authentication.instructions                         | string        | 否                                               | 认证说明,指导客户端如何获取和使用认证信息                                     | "请访问https://epi-keys"提供设为北京业成身份认            |
| authentication.outScopes                            | boolean       | 否                                               | 是否可能涉及跨智能体调用授权                                                  |                                                           |
| authentication.outScopesInstructions                | object        | 否                                               | 跨智能体调用授权说明                                                          | 应该包含明、调用间等信息                                  |
| 所属组织主体                                        |               |                                                  |                                                                               |                                                           |
| ownerID                                             | string        | 是                                               | 所属组织、主体标识                                                            |                                                           |
| 元数据和扩展                                        |               |                                                  |                                                                               |                                                           |
| metadata                                            | object        | 否                                               | 元数据,用于存储扩展信息                                                       |                                                           |
| extensions                                          | object        | 否                                               | 扩展配置,用于特定类型服务的额外配置                                           |                                                           |
| 能力和功能                                          |               |                                                  |                                                                               |                                                           |
| capabilities                                        | object        | 否                                               | 服务能力配置对象                                                              | 见下方详                                                  |
| capabilities.supportedFunctions                     | array[object] | 否                                               | 支持的功能列表                                                                | 见下方详                                                  |
| capabilities.supportedFunctions[].name              | string        | 否                                               | 功能名称                                                                      | "getWea                                                   |
| capabilities.supportedFunctions[].description       | string        | 否                                               | 功能描述                                                                      | "根据城市天气信息                                         |
| capabilities.supportedFunctions[].examples          | array[object] | 否                                               | 功能使用示例                                                                  | 见下方详                                                  |
| capabilities.supportedFunctions[].examples[].input  | object        | 否                                               | 示例输入                                                                      | {"city": "                                                |
| capabilities.supportedFunctions[].examples[].output | object        | 否                                               | 示例输出                                                                      | {"tempe"condition"                                        |

可选，优先级不⾼的字段

| 连接健康检查配置                      |              |     |                                      |                        |
| ------------------------------------- | ------------ | --- | ------------------------------------ | ---------------------- |
| connectionConfig.healthCheck          | object       | 否  | 健康检查配置                         | 见下方详               |
| connectionConfig.healthCheck.endpoint | string (URL) | 否  | 健康检查端点URL                      | &quot;https://m/health |
| connectionConfig.healthCheck.method   | enum         | 否  | 健康检查HTTP方法,默认&quot;GET&quot; | &quot;GET&quot;        |
| connectionConfig.healthCheck.interval | number       | 否  | 健康检查间隔(秒),默认60              | 60                     |

| 兼容性信息                       |               |     |                                  |                   |
| -------------------------------- | ------------- | --- | -------------------------------- | ----------------- |
| compatibility                    | object        | 否  | 兼容性信息,用于匹配LLM客户端能力 |                   |
| compatibility.minProtocolVersion | string        | 否  | 最小协议版本要求                 | "1.0.0"           |
| compatibility.supportedClients   | array[string] | 否  | 支持的客户端类型                 | ["claude "gemini" |
| compatibility.requiredFeatures   | array[string] | 否  | 客户端必需的功能特性             | ["stream"]        |

| connectionConfig.agent.retryPolicy                 | object | 否  | 重试策略配置                                                                     | 见下方详           |
| -------------------------------------------------- | ------ | --- | -------------------------------------------------------------------------------- | ------------------ |
| connectionConfig.agent.retryPolicy.maxRetries      | number | 否  | 最大重试次数,默认3                                                               | 3                  |
| connectionConfig.agent.retryPolicy.retryDelay      | number | 否  | 重试延迟(毫秒),默认1000                                                          | 1000               |
| connectionConfig.agent.retryPolicy.backoffStrategy | enum   | 否  | 退避策略:&quot;linear&quot;、&quot;exponential&quot;,默认&quot;exponential&quot; | &quot;expone&quot; |

## 4. 智能体服务列表查询

功能描述：根据关键词、分类、标签等结构化条件精确搜索服务。适⽤于⽤户明确知道搜索条件的情况。

**使⽤场景：**

⽤户知道具体的分类或标签●

需要精确匹配特定条件

需要组合多个筛选条件

需要按特定字段排序

**请求路径**

略

**请求⽅法**

略

**请求核⼼参数**

| 参数名           | 类型              | 是否必填 | 描述                                             |
| ---------------- | ----------------- | -------- | ------------------------------------------------ |
| identityId       | string            | 否       | mcp/agent服务的标识                              |
| ownerID          | string            | 否       | 提供方主体标识                                   |
| serverIdentityId | string            | 否       | 智能体服务设施身份标识                           |
| q                | string            | 否       | 搜索关键词,支持在名称、描述、标签中精确匹配      |
| type             | enum              | 否       | 服务类型:mcp、agent                              |
| category         | string            | 否       | 主类别                                           |
| subcategory      | string            | 否       | 子类别                                           |
| tags             | array[string]     | 否       | 标签数组,匹配任一标签                            |
| keywords         | array[string]     | 否       | 关键词数组,匹配所有关键词                        |
| createdAfter     | string (ISO 8601) | 否       | 创建时间(之后)                                   |
| createdBefore    | string (ISO 8601) | 否       | 创建时间(之前)                                   |
| updatedAfter     | string (ISO 8601) | 否       | 更新时间(之后)                                   |
| sort             | enum              | 否       | 排序方式:relevance、popularity、created、updated |
| order            | enum              | 否       | 排序顺序:asc、desc                               |
| page             | number            | 否       | 页码,从1开始,默认1                               |
| pageSize         | number            | 否       | 每页数量,默认20,最大100                          |

**响应字段说明：**

total ：总记录数

page ：当前⻚码

pageSize ：每⻚数量

totalPages ：总⻚数

## 5. 智能体服务推荐查询

功能描述：通过⾃然语⾔描述进⾏模糊搜索，使⽤语义理解和意图识别来匹配服务。适⽤于⽤户或智能体⽤⾃然语⾔描述需求的情况。

**使⽤场景：**

⽤户⽤⾃然语⾔描述需求（如"我需要⼀个能查询天⽓的服务"）●

不确定具体的分类或标签

需要语义理解和智能匹配

需要根据意图推荐相关服务

请求核⼼参数

| 字段名            | 类型   | 是否必填 | 描述                        | 示例             |
| ----------------- | ------ | -------- | --------------------------- | ---------------- |
| query             | string | 是       | 自然语言查询描述            | &quot;我需&quot; |
| type              | enum   | 否       | 服务类型:mcp、agent         | &quot;mcp&quot;  |
| limit             | number | 否       | 返回数量,默认20,最大50      | 20               |
| minRelevanceScore | number | 否       | 最小相关性分数(0-1),默认0.5 | 0.6              |

**响应字段说明：**

services ：服务列表

- serviceInfo：服务信息●

- relevanceScore：服务与查询的相关性分数（0-1）●

## 6. 智能体服务⽬录上报/同步

参考现有全域数据目录上报 全域目录同步 接口，新增目录类型

dataType=4 智能体服务目录上报

type=5 智能体服务目录上架信息

# 三、拓展方案及接口

**本⽅案原则：**

1. ⽤户为智能体A服务提供双签授权的同时，给出相应的token消耗额度，可以类⽐为⽤户为智能体划拨⽀票

2. ⽤户不会并发调⽤同⼀个智能体

**因此：**

1. 持有⽀票的智能体（智能体A）应保证后续调⽤操作、授权额度更新的原⼦性

2. 持有⽀票的智能体（智能体A）因为并发导致的⽀出溢出，应该由持票⼈（智能体A）所属主体负责

## 1. 流程

![image](index_files/a9564595d257eec7436ac1ca308e6a40985182d79610dbc31a21bd76e7b881a7-177934979081515.jpg)

## 2. 授权请求

**接⼝说明**

在完成身份挑战应答后，如果智能体A需要使⽤⽤户的身份进⾏跨智能体调⽤，需要由⽤户和发起智能体进⾏双签授权，流程如下：

1. 智能体确认需要使⽤⽤户的主体信息等授权，将授权相应的信息进⾏签名，并通过客户端的证书进⾏加密，获得加密⽂本，对应的明⽂参数标准化展示如下

```txt
"AuthorizationMsg": {
    "PurposeText": "授权操作明文",
    "PurposeTextHash": "授权操作明文的哈希值",
    "ExpirationTime": "超时时间",
    "AuthorizationRegistry": {
    "registryUrl": "授权登记地址、标识、合约",
    "contractAddress": "did:bid:tele:abc**"
    }
    "Authorizer": "授权用户标识/did",
    "AuthorizedUser": "被授权智能体标识/did"
},
"AuthorizedSign": "被授权智能体签名"
```

2. 客户端使⽤私钥解密加密⽂本后，对授权信息明⽂进⾏校验，由⽤户对明⽂进⾏授权，授权成功后，客户端使⽤⽤户身份的私钥对明⽂及智能体的签名进⾏签名，并通过智能体的证书进⾏加密，获得加密⽂本，对应的明⽂参数标准化展示如下

```json
"AuthorizationInfo": {
    "AuthorizationMsg": {
    "PurposeText": "授权操作明文",
    "PurposeTextHash": "授权操作明文的哈希值",
    "ExpirationTime": "超时时间",
    "AuthorizationRegistry": {
    "registryUrl": "授权登记地址、标识、合约",
    "contractAddress": "did:bid:tele:abc**"
    }
    "Authorizer": "授权用户标识/did",
    "AuthorizedUser": "被授权智能体标识/did"
},
"AuthorizedSign": "被授权智能体签名",
"AuthorizerSign": "授权用户签名"
}
```

3. 客户端将对应的授权信息发送给业务/区域节点/区块链合约，进⾏授权登记

4. 客户端将对应的授权信息发送给智能体A

5. 智能体A获取加密⽂本后，使⽤⾃⼰的私钥解密，确认⽤户授权的签名⽆误

6. 智能体A确认授权成⽴

7. 智能体A携带授权信息向新的智能体B发起请求

8. 智能体B获取到授权信息后，逐个验证两个签名，确认超时时间⽆误

9. 智能体B通过授权登记的地址、标识或合约，确认授权的权限和token消耗符合要求

10.智能体B提供相应服务

11.智能体B完成服务提供后，智能体A更新调⽤深度、token消耗记录等信息

**请求路径**

略

**请求⽅法**

略

请求核⼼参数

| 参数名            | 类型   | 是否必填 | 描述     | 示例     |
| ----------------- | ------ | -------- | -------- | -------- |
| AuthorizationInfo | object | 是       | 授权信息 | 参照上文 |

响应核⼼参数

| 参数名            | 类型   | 是否必填 | 描述     | 示例     |
| ----------------- | ------ | -------- | -------- | -------- |
| AuthorizationInfo | object | 是       | 授权信息 | 参照上文 |

## 3. 智能体授权信息登记、更新、关闭

**接⼝说明：**

1. ⽤户在确认智能体的授权信息后，需要将授权信息登记在智能体授权信息管理平台上，记录信息以⽤户标识和智能体服务A标识为键，存储本次请求的授权token上限及调⽤次数上限等信息；key可选添加授权信息的哈希，⽤于为每次授权提供单独的额度

2. 有权限的智能体A在调⽤完成后，需要同步更新智能体授权信息，可更新信息示例如：token消耗数量、调⽤次数，本次调⽤的智能体或MCP服务的标识信息

3. 在单次授权完成后、⽤户、有权限的智能体关闭此次授权，完成服务流程

**请求路径**

略

**请求⽅法**

略

**请求核⼼参数**

| 参数名             | 类型    | 是否必填 | 描述           | 示例 |
| ------------------ | ------- | -------- | -------------- | ---- |
| Authorizer         | string  | 是       | 用户标识       |      |
| AuthorizedUser     | string  | 是       | 智能体标识     |      |
| PurposeText        | string  | 是       | 授权信息       |      |
| ExpirationTime     | string  | 是       | 超时时间       |      |
| RecursionDepth     | int     | 否       | 递归深度       |      |
| TokenLimit         | bigint  | 否       | token上限      |      |
| AuthorizationScope | array[] | 是       | 授权的字典信息 |      |

## 4. 智能体授权与使⽤记录参考

我们以solidity合约标准为例 给出示例

```solidity
// 支票式授权合约
contract CheckAuthorization {
    // 授权结构（用户开的支票）
    struct Authorization {
    address user;    // 用户
    address agent;    // 持票人（智能体A）
    address token;    // 数据券等地址
    uint256 totalAmount;    // 支票总额
    uint256 remainingAmount;  // 剩余金额
    uint256 createdAt;    // 创建时间
    uint256 expiresAt;    // 过期时间
    Status status;    // 状态
    }
    // 结算记录（兑现支票的记录）
    struct Settlement {
    bytes32 settlingId;    // 结算ID
    bytes32 checkId;    // 授权ID（支票ID）
```

```txt
address claimer;    //兑现人（智能体A）
address service;    //服务提供方（B/C/D）
uint256 amount;    //结算金额
uint256 timestamp;    //结算时间
string purpose;    //用途
bytes32 proofHash;    //服务完成证明
}
enum Status { ACTIVE, PAUSED, COMPLETED, EXPIRED, REVOKED }
mapping(bytes32 => Authorization) public authorizations;
mapping(bytes32 => Settlement) public settlements;
mapping(bytes32 => bytes32[]) public authSettlements;  //授权对应的结算记录
```

// 事件

```txt
event AuthorizationCreated(
    bytes32 indexed checkId,
    address indexed user,
    address indexed agent,
    address token,
    uint256 totalAmount,
    uint256 expiresAt
);

event CheckCashed(
    bytes32 indexed settlementId,
    bytes32 indexed checkId,
    address indexed service,
    address claimer,
    uint256 amount,
    uint256 remainingAmount,
    bytes32 proofHash
);

event AuthorizationUpdated(
    bytes32 indexed checkId,
    uint256 newRemainingAmount
);
}
```

### 4.1 ⽤户授权

// 用户开支票给智能体A

```javascript
function writeCheck(
    address agent, // 智能体A（持票人）
    address token, // 代币地址
    uint256 totalAmount, // 支票总额
    uint256 duration // 有效期（秒）
) external returns (bytes32 checkId) {
    require(agent != address(0), "Invalid agent address");
    require(token != address(0), "Invalid token address");
    require(totalAmount > 0, "Amount must be > 0");
    require(duration > 0, "Duration must be > 0");
```

// 边界校验示例：检查余额

```javascript
IERC20 tokenContract = IERC20(token);
require(
    tokenContract.balanceOf(msg.sender) >= totalAmount,
    "Insufficient token balance"
);
```

// 边界校验示例：检查授权额度

```javascript
require(tokenContract.allowance(msg.sender, address(this)) >=
  totalAmount, 'Insufficient token allowance')
```

// 生成支票ID示例

```javascript
checkId = keccak256(
  abi.encodePacked(msg.sender, agent, token, totalAmount, block.timestamp, block.prevrandao)
)
```

// 转移资金到合约（锁定资金）

```javascript
require(tokenContract.transferFrom(msg.sender, address(this), totalAmount), 'Token transfer failed')
```

// 创建支票

```txt
authorizations[checkId] = Authorization({
```

```typescript
user: msg.sender,
agent: agent,
token: token,
totalAmount: totalAmount,
remainingAmount: totalAmount,
createdAt: block.timestamp,
expiresAt: block.timestamp + duration,
status: Status.ACTIVE
});

emit AuthorizationCreated(
    checkId,
    msg.sender,
    agent,
    token,
    totalAmount,
    block.timestamp + duration
);

return authId;
}
```

### 4.2 调⽤完成后的链上结算

```javascript
// 智能体A兑现支票
function cashCheck(
    bytes32 checkId, // 支票ID
    address service, // 服务提供方地址（B/C）
    uint256 amount, // 结算金额
    string calldata purpose, // 用途描述
    bytes32 proofHash // 服务完成证明的哈希
) external returns (bytes32 settlingId) {
    Authorization storage check = authorizations[checkId];

    // 边界校验示例：验证权限
    require(msg.sender == check.agent, "Only authorized agent can cash check");
    require(check.status == Status.ACTIVE, "Check not active");
    require(block.timestamp <= check.expiresAt, "Check expired");
    require(amount > 0, "Amount must be > 0");

    // 边界校验示例：检查剩余额度
```

require(amount <= check.remainingAmount, "Amount exceeds remaining balance");

// 生成结算ID

```javascript
settlementId = keccak256(abi.encodePacked(checkId, service, amount, proofHash, block.timestamp))
```

// 记录结算

```javascript
settlements[settlementId] = Settlement({
  settlingId: settlingId,
  checkId: checkId,
  claimer: msg.sender,
  service: service,
  amount: amount,
  timestamp: block.timestamp,
  purpose: purpose,
  proofHash: proofHash
})
```

// 添加到授权结算列表

```javascript
authSettlements[checkId].push(settlementId)
```

// 更新支票余额示例，注意溢出问题

```txt
check.remainingAmount -= amount;
```

// 转账给服务提供方

```javascript
IERC20 tokenContract = IERC20(check.token);
require(
    tokenContract.transfer(service, amount),
    "Payment failed"
);
```

// 检查是否用完

```txt
if (check.removingAmount == 0) {
    check.status = Status.COMPLETED;
}
emit CheckCashed(
    settlingId,
    checkId,
```

```txt
service,
msg.sender,
amount,
check.remainingAmount,
proofHash
);
emit AuthorizationUpdated(checkId, check.remainingAmount);
return settlingId;
```

### 4.3 状态信息和管理

// 支票状态查询

```solidity
contract CheckManager {
    CheckAuthorization public checkContract;

    // 获取支票详情
    function getCheckDetails(bytes32 checkId)
    external view returns (
    address user,
    address agent,
    uint256 totalAmount,
    uint256 remainingAmount,
    uint256 expiresAt,
    bool isActive,
    Settlement[] memory settlements
    )
    {
    CheckAuthorization.Authorization memory check = checkContract.authorizations(checkId);

    // 获取所有结算记录
    bytes32[] memory settlementIds =
    checkContract.authSettlements(checkId);
    settlements = new Settlement[] (settlementIds.length);

    for (uint256 i = 0; i < settlementIds.length; i++) {
    settlements[i] =
    checkContract.settlements(settlementIds[i]);
    }
```

复制代码

```javascript
return (
    check.user,
    check.agent,
    check.totalAmount,
    check.remissingAmount,
    check.expiresAt,
    (check.status == CheckAuthorization.Status.ACTIVE && block.timestamp <= check.expiresAt),
    settlements
);
}

// 检查是否可以结算
function canCashCheck(
    bytes32 checkId,
    uint256 amount
) external view returns (bool canCash, string memory reason) {
    CheckAuthorization.Authorization memory check =
    checkContract.authorizations(checkId);

    if (check.status != CheckAuthorization.Status.ACTIVE) {
    return (false, "Check not active");
    }

    if (block.timestamp > check.expiresAt) {
    return (false, "Check expired");
    }

    if (amount > check.remissingAmount) {
    return (false, "Insufficient funds");
    }

    return (true, "");
}
```

详细接⼝定义规范⻅附录

### 4.4 后续拓展思路

1. 增加锁的机制等，解锁并发调⽤场景。 待解决问题：会增加链上调⽤的次数

2. 链下跨智能体调⽤改为链上智能体任务提交，解锁异步调⽤场景。 待解决问题：异步调⽤时间过⻓，错误处理困难

# 四、通信协议统⼀身份认证要求

智能体互联互通身份认证可采⽤OAuth 2.0流程，允许⽤户授权第三⽅应⽤访问其在其他服务上的资源，通过挑战应答双向身份认证获取访问令牌，挑战应答的客户端应为⽤户侧轻量连接器，服务端为智能体服务设施身份，可以是区域节点、业务节点、接⼊连接器、智能体基础设施或智能体服务本身；也可能是智能体服务与智能体服务

客户端或智能体在完成推荐查询获取合适智能体服务后，客户端通过授权字段的授权地址发起挑战应答，获取智能体服务设施的访问token，⽽后将token组装在请求头中传递

```txt
√ 复制代码
Authorization: Bearer <access-token>
```

客户端需要授权进⾏身份认证的场景包含：

1. 智能体服务发现

2. ⽤户直接调⽤智能体服务

在智能体以⾃身身份访问其他智能体服务，不需要主体权限及数据时，不需要客户端进⾏授权

# 五、模型上下⽂协议（MCP）

## 1. 协议概述

模型上下⽂协议 是⼀个开放标准，⽤于标准化⼤模型应⽤程序或这能提与外部⼯具、数据源和服务之间的通信。本协议定义了第三⽅开发商在实现MCP服务时必须遵循的通信规范。

### 1.1 核⼼原则

标准化：使⽤JSON-RPC 2.0作为消息格式

灵活性：⽀持多种传输⽅式（stdio、SSE、WebSocket）●

可扩展性：⽀持流式传输和⻓时间运⾏的任务

安全性：⽀持身份认证和授权机制●

### 1.2 架构模型

MCP采⽤客户端-服务器架构：

MCP服务器（Server）：提供⼯具、资源和提示的服务端实现●

MCP客户端（Client）：LLM应⽤程序中的客户端实现●

传输层（Transport）：负责消息的传输（stdio、SSE、WebSocket）●

## 2. 消息格式

### 2.1 JSON-RPC 2.0基础

所有MCP消息必须遵循JSON-RPC 2.0规范。

#### 2.1.1 请求消息格式

```json
√
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
    "name": "get_weather",
    "arguments": {
    "city": "北京"
    }
    }
}
```

**字段说明：**

jsonrpc ：固定为"2.0"

id ：请求的唯⼀标识符（数字或字符串），⽤于匹配响应

method ：要调⽤的⽅法名称

params ：⽅法参数（可选）

#### 2.1.2 响应消息格式

**成功响应：**

```txt
√ 复制代码
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
    "content": [
```

```json
{
    "type": "text",
    "text": "北京今天晴天，温度25°C"
}
]
```

错误响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "param": "city",
      "reason": "City name is required"
    }
  }
}
```

**字段说明：**

result ：⽅法执⾏结果（成功时）

error ：错误信息（失败时）

○ code ：错误代码（标准JSON-RPC错误代码或⾃定义代码）

○ message ：错误消息

data ：错误详情（可选）

#### 2.1.3 通知消息格式

通知消息不需要响应，⽤于向客户端推送实时状态更新和事件信息等：

```json
√ 复制代码
{
    "jsonrpc": "2.0",
    "method": "notifications/progress",
    "params": {
    "progressId": "task-123",
    "message": "Processing data...",
    "percentage": 50
    }
}
```

### 2.2 MCP标准⽅法

#### 2.2.1 初始化⽅法

initialize客户端发送初始化请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "roots": {
        "listChanged": true
      },
      "sampling": {}
    },
    "clientInfo": {
      "name": "claude-desktop",
      "version": "1.0.0"
    }
  }
}
```

服务器响应：

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
    "tools": {},
    "resources": {},
    "prompts": {}
    },
    "serverInfo": {
    "name": "weather-mcp-server",
    "version": "1.0.0"
    }
}
```

```txt
}
}
```

#### 2.2.2 ⼯具相关⽅法

tools/list- 列出可⽤⼯具

tools/call- 调⽤⼯具执⾏操作

tools/cancel- 取消正在执⾏的⼯具调⽤

tools/list列出所有可⽤⼯具：

```json
√
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "inputSchema": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称"
            }
          },
          "required": ["city"]
        }
      }
    ]
  }
}
```

tools/call调⽤⼯具：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "city": "北京"
    }
  }
}
```

响应：

```json
√
{
    "jsonrpc": "2.0",
    "id": 3,
    "result": {
    "content": [
    {
    "type": "text",
    "text": "北京今天晴天，温度25℃，湿度60%""
    }
    ],
    "isError": false
    }
}
```

#### 2.2.3 资源相关⽅法

resources/list- 列出可⽤资源

resources/read- 读取资源内容

resources/write- 写⼊资源内容

resources/subscribe- 订阅资源变更通知

resources/list列出所有可⽤资源：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/list"
}
```

resources/read读取资源内容：

```json
√
{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "resources/read",
    "params": {
    "uri": "file:///path/to/document.txt"
    }
}
```

#### 2.2.4 提示相关⽅法

prompts/list- 列出可⽤提示模板

prompts/get- 获取特定提示模板

prompts/execute- 执⾏提示并获取结果

prompts/list列出所有可⽤提示：

```json
√ 复制代码
{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "prompts/list"
}
```

prompts/get获取提示内容：

```txt
√ 复制代码
{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "prompts/get",
    "params": {
    "name": "summarize",
    "arguments": {
```

```json
"text": "要总结的文本内容"
}
}
```

## 3. 传输⽅式

### 3.1 标准输⼊输出（stdio）

#### 3.1.1 连接建⽴

客户端以⼦进程形式启动MCP服务器：

```txt
√ 复制代码
node /path/to/mcp-server.js
```

服务器通过标准输⼊（stdin）接收JSON-RPC消息，通过标准输出（stdout）发送响应。

#### 3.1.2 消息编码

每条消息必须以换⾏符（ \n ）结尾●

消息必须是有效的JSON格式

使⽤UTF-8编码

示例：

```javascript
复制代码
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"}}\n {"jsonrpc":"2.0","id":1,"result":{"}}\n
```

#### 3.1.3 错误处理

如果收到⽆效的JSON，应发送错误响应●

如果处理过程中发⽣错误，应返回包含错误信息的响应●

服务器应保持进程运⾏，直到收到退出信号

### 3.2 Server-Sent Events (SSE)

#### 3.2.1 连接建⽴

客户端通过HTTP连接到SSE端点：

```txt
√ 复制代码
GET /mcp/sse HTTP/1.1
```

```yaml
Host: api.example.com
Accept: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

服务器响应：

```txt
√ 复制代码
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

#### 3.2.2 消息格式

每条SSE消息格式：

```jsonl
√ 复制代码
event: message
data: {"jsonrpc":"2.0","id":1,"method":"initialize","params":...}}
```

**字段说明：**

event ：事件类型（通常为"message"）

data ：JSON-RPC消息（JSON字符串）

#### 3.2.3 双向通信

SSE是单向的（服务器到客户端），客户端请求通过HTTP POST发送：

```txt
√ 复制代码
POST /mcp/sse/message HTTP/1.1
Host: api.example.com
Content-Type: application/json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {...}
}
```

#### 3.2.4 ⼼跳机制

服务器应定期发送⼼跳消息保持连接：

```txt
√ 复制代码
: heartbeat
```

### 3.3 WebSocket

#### 3.3.1 连接建⽴

客户端通过WebSocket连接到端点：

```javascript
√ 复制代码
const ws = new WebSocket('wss://api.example.com/mcp/ws');
```

服务器应⽀持WebSocket握⼿协议。

#### 3.3.2 消息格式

WebSocket消息直接传输JSON-RPC消息（⽂本帧）：

```jsonl
√ 复制代码
{"jsonrpc":"2.0","id":1,"method":"initialize","params":...}}
```

#### 3.3.3 连接管理

客户端和服务器都可以发送ping/pong消息保持连接

连接断开时应优雅地处理重连逻辑

## 4. 流式传输说明

### 4.1 流式响应

对于⻓时间运⾏的任务，服务器可以发送多个部分响应：

```json
√
{
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/call",
    "params": {
    "name": "long_running_task"
    }
}
```

服务器发送进度更新（通知消息）：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "task-123",
    "progress": 30,
    "total": 100,
    "status": "Processing..."
  }
}
```

复制代码

最终结果：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "任务完成"
      }
    ]
  }
}
```

### 4.2 流式内容

对于⼤量内容，可以分块发送：

```txt
√
{
    "jsonrpc": "2.0",
    "id": 11,
    "result": {
    "content": [
    {
    "type": "text",
    "text": "第一部分内容"
    }
    ],
}
```

```json
"isError": false
}
```

后续通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "content-123",
    "content": [
      {
        "type": "text",
        "text": "第二部分内容"
      }
    ]
  }
}
```

# 六、智能体间通信协议

## 1. 协议概述

Agent间通信协议（Agent-to-Agent Communication Protocol，A2A）定义了智能体之间进⾏安全、⾼效通信的标准规范。

### 1.1 核⼼原则

互操作性：⽀持不同框架和平台的智能体通信

标准化：统⼀的消息格式和接⼝规范

安全性：端到端加密和身份认证●

可扩展性：⽀持多种传输协议和内容类型

可靠性：任务管理和错误恢复机制

⽤户友好：⽀持丰富的UI组件和交互模式●

### 1.2 通信模式

Agent间通信（A2A）⽀持三种模式：

1. 同步通信：请求-响应模式，适⽤于快速交互

2. 异步通信：任务提交和结果回调，适⽤于⻓时间运⾏的任务

3. 流式通信：实时数据流传输，适⽤于实时协作

## 2. 消息格式

### 2.1 基础消息结构

所有Agent间通信消息遵循统⼀的基础结构：

```json
√
{
    "version": "1.0",
    "id": "msg-123456",
    "timestamp": "2024-01-15T10:30:00Z",
    "from": {
    "agentId": "agent-001",
    "agentName": "数据分析智能体",
    "capabilities": ["data_analysis", "visualization"]
    },
    "to": {
    "agentId": "agent-002",
    "agentName": "报告生成智能体"
    },
    "type": "request",
    "payload": {}
}
```

**字段说明：**

version ：协议版本号

id ：消息唯⼀标识符

timestamp ：消息时间戳（ISO 8601格式）

from ：发送⽅Agent信息或标识

to ：接收⽅Agent信息或标识

type ：消息类型（request、response、notifi cation、error）

payload ：消息负载

### 2.2 请求消息

```txt
√ 复制代码
{
```

```json
{
  "version": "1.0",
  "id": "req-001",
  "timestamp": "2024-01-15T10:30:00Z",
  "from": {
    "agentId": "agent-001",
    "agentName": "数据分析智能体"
  },
  "to": {
    "agentId": "agent-002",
    "agentName": "报告生成智能体"
  },
  "type": "request",
  "payload": {
    "action": "generate_report",
    "parameters": {
      "data": "分析结果数据",
      "format": "pdf",
      "template": "standard"
    },
    "options": {
      "async": false,
      "timeout": 30000,
      "priority": "normal"
    }
  }
}
```

### 2.3 响应消息

成功响应：

```json
√
{
    "version": "1.0",
    "id": "resp-001",
    "timestamp": "2024-01-15T10:30:05Z",
    "from": {
    "agentId": "agent-002",
    "agentName": "报告生成智能体"
    },
    "to": {
    "agentId": "agent-001",
    "agentName": "数据分析智能体"
    },
    "type": "response"
}
```

```json
"requestId": "req-001",
"payload": {
    "status": "success",
    "result": {
    "reportUrl": "https://storage.example.com/reports/report-123.pdf",
    "reportId": "report-123",
    "size": 1024000
    }
}
```

错误响应：

```json
{
  "version": "1.0",
  "id": "resp-002",
  "timestamp": "2024-01-15T10:30:05Z",
  "from": {
    "agentId": "agent-002",
    "agentName": "报告生成智能体"
  },
  "to": {
    "agentId": "agent-001",
    "agentName": "数据分析智能体"
  },
  "type": "error",
  "requestId": "req-001",
  "payload": {
    "status": "error",
    "error": {
      "code": "INVALID_PARAMETER",
      "message": "Template 'standard' not found",
      "details": {
        "parameter": "template",
        "available": ["basic", "advanced"]
      }
    }
  }
}
```

### 2.4 通知消息

通知消息⽤于状态更新和事件推送：

```json
{
  "version": "1.0",
  "id": "notif-001",
  "timestamp": "2024-01-15T10:30:10Z",
  "from": {
    "agentId": "agent-002",
    "agentName": "报告生成智能体"
  },
  "to": {
    "agentId": "agent-001",
    "agentName": "数据分析智能体"
  },
  "type": "notification",
  "payload": {
    "event": "task_progress",
    "taskId": "task-123",
    "data": {
      "progress": 75,
      "status": "processing",
      "message": "正在生成图表..."
    }
  }
}
```

## 3. 传输协议

### 3.1 HTTP/HTTPS

#### 3.1.1 同步请求

请求：

```txt
√
POST /api/v1/agent/communicate HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer <token>
{
    "version": "1.0",
    "id": "req-001",
    "type": "request",
    "payload": {...}
}
```

响应：

```txt
HTTP/1.1 200 OK
Content-Type: application/json
{
    "version": "1.0",
    "id": "resp-001",
    "type": "response",
    "payload": {...}
}
```

#### 3.1.2 异步任务提交

提交任务：

```json
POST /api/v1/agent/tasks HTTP/1.1
Host: api.example.com
Content-Type: application/json
{
    "version": "1.0",
    "id": "task-001",
    "type": "request",
    "payload": {
    "action": "long_running_task",
    "parameters": {...},
    "callback": {
    "url": "https://callback.example.com/result",
    "method": "POST"
    }
    }
}
```

任务响应：

```txt
HTTP/1.1 202 Accepted
Content-Type: application/json
{
    "version": "1.0",
    "id": "task-resp-001",
    "type": "response",
    "payload": {
```

```json
"status": "accepted",
"taskId": "task-123",
"estimatedTime": 300
}
```

#### 3.1.3 任务状态查询

```txt
√ 复制代码
GET /api/v1/agent/tasks/task-123 HTTP/1.1
Host: api.example.com
Authorization: Bearer <token>
```

响应：

```json
HTTP/1.1 200 OK
Content-Type: application/json
{
    "version": "1.0",
    "id": "status-001",
    "type": "response",
    "payload": {
    "taskId": "task-123",
    "status": "processing",
    "progress": 50,
    "result": null
    }
}
```

### 3.2 Server-Sent Events (SSE)

⽤于实时状态更新和流式通信：

建⽴连接：

```txt
√ 复制代码
GET /api/v1/agent/stream?agentId=agent-001 HTTP/1.1
Host: api.example.com
Accept: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Authorization: Bearer <token>
```

服务器推送：

```javascript
√ 复制代码
event: message
data: {"version":"1.0","id":"msg-001","type":"notification","payload": {...}}
event: progress
data: {"taskId":"task-123","progress":50,"status":"processing": heartbeat
```

### 3.3 WebSocket

⽤于双向实时通信：

连接建⽴：

```javascript
√
const ws = new WebSocket('wss://api.example.com/agent/ws', {
    headers: {
    'Authorization': 'Bearer <token>'
    }
});
```

消息格式：WebSocket直接传输JSON消息：

```json
√
{
    "version": "1.0",
    "id": "ws-001",
    "type": "request",
    "payload": {...}
}
```

⼼跳机制：

```json
√ 复制代码
{
    "type": "ping",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### 3.4 gRPC

使⽤Protocol Buff ers定义服务：

```proto
syntax = "proto3";
package agent. communication;
service AgentCommunication {
    rpc SendMessage(MessageRequest) returns (MessageResponse);
    rpc StreamMessage(MessageRequest) returns (stream MessageResponse);
    rpc SubmitTask(TaskRequest) returns (TaskResponse);
    rpc GetTaskStatus(TaskStatusRequest) returns (TaskStatusResponse);
}
message MessageRequest {
    string version = 1;
    string id = 2;
    string timestamp = 3;
    AgentInfo from = 4;
    AgentInfo to = 5;
    string type = 6;
    bytes payload = 7;
}
message MessageResponse {
    string version = 1;
    string id = 2;
    string request_id = 3;
    string type = 4;
    bytes payload = 5;
}
```

## 4. 内容类型

### 4.1 ⽂本内容

```json
√
{
    "contentType": "text/plain",
    "content": "这是文本内容"
}
```

### 4.2 JSON数据

```txt
复制代码
{
```

```javascript
"contentType": "application/json",
"content": {
    "key": "value",
    "data": [1, 2, 3]
}
```

4.3 ⽂件内容

```json
√
{
    "contentType": "application/octet-stream",
    "content": {
    "url": "https://storage.example.com/files/file-123.pdf",
    "filename": "report.pdf",
    "size": 1024000,
    "mimeType": "application/pdf"
    }
}
```

4.4 多模态内容

```json
{
  "contentType": "multipart/mixed",
  "content": [
    {
      "type": "text",
      "data": "分析结果摘要"
    },
    {
      "type": "image",
      "url": "https://storage.example.com/images/chart-123.png",
      "mimeType": "image/png"
    },
    {
      "type": "file",
      "url": "https://storage.example.com/files/data.csv",
      "filename": "data.csv"
    }
  ]
}
```

## 5. 任务管理

### 5.1 任务发起

```json
{
  "version": "1.0",
  "id": "task-001",
  "type": "request",
  "payload": {
    "action": "process_data",
    "parameters": {
      "dataSource": "https://example.com/data.csv",
      "operations": ["clean", "analyze", "visualize"]
    },
    "options": {
      "async": true,
      "timeout": 600000,
      "priority": "high",
      "callback": {
        "url": "https://callback.example.com/task/result",
        "method": "POST",
        "headers": {
          "Authorization": "Bearer <callback-token>"
        }
      }
    }
  }
}
```

### 5.2 任务状态更新

```json
√
{
    "version": "1.0",
    "id": "notif-001",
    "type": "notification",
    "payload": {
    "event": "task_progress",
    "taskId": "task-123",
    "data": {
    "status": "processing",
    "progress": 50,
    }
}
```

```json
"currentStep": "analyzing",
"message": "正在分析数据…",
"estimatedTimeRemaining": 120
}
```

5.3 任务完成通知

```json
{
  "version": "1.0",
  "id": "notif-002",
  "type": "notification",
  "payload": {
    "event": "task_completed",
    "taskId": "task-123",
    "data": {
      "status": "completed",
      "result": {
        "outputUrl": "https://storage.example.com/results/result-123.json",
        "summary": "处理完成，生成了3个可视化图表"
      },
      "duration": 245000
    }
  }
}
```

**附录**

标签分类参考

| 主类别         | 子类别       | 描述                                         | 适用类型   | 示例                      |
| -------------- | ------------ | -------------------------------------------- | ---------- | ------------------------- |
| 数据处理       | 数据清洗     | 对原始数据进行清理、去重、格式化等预处理操作 | MCP, Agent | ETL工具、数据清洗服务     |
|                | 数据分析     | 对数据进行统计分析、模式识别和洞察提取       | MCP, Agent | 数据分析平台、统计工具    |
|                | 数据可视化   | 将数据转换为图表、仪表盘等可视化形式         | MCP, Agent | 图表生成工具、BI平台      |
|                | 数据转换     | 数据格式转换、结构重组和映射                 | MCP        | 数据转换工具、格式转换器  |
|                | 数据存储     | 数据存储、检索和管理服务                     | MCP        | 数据库连接器、存储API     |
| 自然语言处理   | 文本生成     | 根据输入生成文章、报告、邮件等文本内容       | MCP, Agent | 文本生成模型、写作助手    |
|                | 文本摘要     | 提取文本的关键信息和摘要                     | MCP, Agent | 摘要生成工具、文档总结    |
|                | 机器翻译     | 多语言文本翻译服务                           | MCP, Agent | 翻译API、语言转换工具     |
|                | 情感分析     | 分析文本的情感倾向和情绪                     | MCP, Agent | 情感分析工具、舆情分析    |
|                | 语义分析     | 理解文本的语义、意图和上下文                 | MCP, Agent | 语义解析器、意图识别      |
|                | 文本分类     | 对文本进行分类和标签化                       | MCP, Agent | 文本分类器、内容分类      |
|                | 命名实体识别 | 识别文本中的人名、地名、组织等实体           | MCP, Agent | NER工具、实体提取         |
|                | 关键词提取   | 从文本中提取关键词和主题                     | MCP, Agent | 关键词提取工具、主题分析  |
| 计算机视觉     | 图像识别     | 识别和分类图像中的对象、场景                 | MCP, Agent | 图像识别API、物体检测     |
|                | 图像生成     | 根据描述生成图像内容                         | MCP, Agent | AI绘画工具、图像生成模型  |
|                | 图像处理     | 图像编辑、增强、滤镜等处理                   | MCP, Agent | 图像处理工具、图片编辑器  |
|                | OCR识别      | 将图像中的文字转换为可编辑文本               | MCP, Agent | OCR工具、文字识别         |
|                | 人脸识别     | 人脸检测、识别和验证                         | MCP, Agent | 人脸识别API、身份验证     |
|                | 视频分析     | 视频内容分析、动作识别、事件检测             | MCP, Agent | 视频分析工具、动作识别    |
|                | 图像标注     | 为图像添加标签和描述                         | MCP, Agent | 图像标注工具、自动标注    |
| 语音处理       | 语音识别     | 将语音转换为文本(ASR)                        | MCP, Agent | 语音转文字、语音识别API   |
|                | 语音合成     | 将文本转换为自然语音(TTS)                    | MCP, Agent | 语音合成工具、TTS服务     |
|                | 语音分析     | 语音情感分析、说话人识别                     | MCP, Agent | 语音分析工具、声纹识别    |
|                | 语音翻译     | 实时语音翻译服务                             | MCP, Agent | 实时翻译、语音翻译API     |
| 搜索与推荐     | 搜索引擎     | 提供搜索功能和结果排序                       | MCP, Agent | 搜索API、全文检索         |
|                | 个性化推荐   | 基于用户行为和偏好推荐内容                   | MCP, Agent | 推荐引擎、内容推荐        |
|                | 协同过滤     | 基于用户相似性的推荐算法                     | Agent      | 协同过滤算法、推荐系统    |
|                | 内容匹配     | 内容相似度匹配和检索                         | MCP, Agent | 相似度计算、内容匹配      |
| 通信与协作     | 即时通讯     | 实时消息传递和聊天功能                       | MCP, Agent | 聊天API、消息服务         |
|                | 邮件处理     | 邮件发送、接收和处理                         | MCP, Agent | 邮件服务、邮件自动化      |
|                | 视频会议     | 视频通话和会议功能                           | MCP, Agent | 视频会议API、会议工具     |
|                | 协作工具     | 团队协作和项目管理                           | Agent      | 协作平台、项目管理工具    |
| 自动化与工作流 | 任务自动化   | 自动化执行重复性任务                         | Agent      | RPA工具、自动化脚本       |
|                | 工作流引擎   | 管理和执行复杂工作流程                       | Agent      | 工作流引擎、流程管理      |
|                | 任务调度     | 定时任务和作业调度                           | MCP, Agent | 任务调度器、定时任务      |
|                | 流程编排     | 业务流程编排和协调                           | Agent      | 流程编排工具、业务流程    |
| 开发工具       | API管理      | API开发、测试和管理                          | MCP        | API网关、API文档生成      |
|                | 代码生成     | 根据需求生成代码                             | MCP, Agent | 代码生成工具、AI编程助手  |
|                | 代码分析     | 代码质量分析、漏洞检测                       | MCP        | 代码分析工具、静态分析    |
|                | 调试工具     | 代码调试和性能分析                           | MCP        | 调试器、性能监控          |
|                | 日志管理     | 日志收集、存储和分析                         | MCP        | 日志管理工具、日志分析    |
|                | 测试工具     | 自动化测试和测试管理                         | MCP, Agent | 测试框架、测试自动化      |
| 数据库与存储   | 数据库连接   | 连接和操作各种数据库                         | MCP        | 数据库连接器、ORM工具     |
|                | 数据同步     | 数据库同步和备份                             | MCP        | 数据同步工具、备份服务    |
|                | 缓存服务     | 缓存管理和加速服务                           | MCP        | 缓存工具、Redis客户端     |
|                | 文件存储     | 文件上传、下载和管理                         | MCP        | 文件存储服务、云存储      |
| 网络与通信     | HTTP客户端   | HTTP请求处理和API调用                        | MCP        | HTTP客户端库、REST客户端  |
|                | WebSocket    | WebSocket连接和实时通信                      | MCP        | WebSocket客户端、实时通信 |
|                | 消息队列     | 消息队列和异步通信                           | MCP        | 消息队列客户端、MQ工具    |
|                | 网络监控     | 网络状态监控和分析                           | MCP        | 网络监控工具、性能分析    |
| 安全与认证     | 身份认证     | 用户身份验证和授权                           | MCP, Agent | OAuth工具、JWT生成器      |
|                | 数据加密     | 数据加密和解密服务                           | MCP        | 加密工具、加密库          |
|                | 安全扫描     | 安全漏洞扫描和检测                           | MCP, Agent | 漏洞扫描工具、安全检测    |
|                | 访问控制     | 权限管理和访问控制                           | MCP, Agent | 权限管理、访问控制        |
| 监控与运维     | 系统监控     | 系统性能监控和告警                           | MCP, Agent | 监控工具、性能监控        |
|                | 日志分析     | 日志收集、分析和可视化                       | MCP, Agent | 日志分析平台、日志工具    |
|                | 告警通知     | 异常告警和通知服务                           | MCP, Agent | 告警系统、通知服务        |
|                | 自动化部署   | 自动化部署和发布                             | MCP, Agent | CI/CD工具、部署自动化     |
| 内容创作       | 文档生成     | 自动生成文档、报告                           | MCP, Agent | 文档生成工具、报告生成    |
|                | 图像创作     | AI图像生成和设计                             | MCP, Agent | AI绘画、图像生成          |
|                | 视频创作     | 视频编辑和生成                               | MCP, Agent | 视频编辑工具、视频生成    |
|                | 音频创作     | 音频生成和处理                               | MCP, Agent | 音乐生成、音频处理        |
|                | 代码生成     | 代码自动生成                                 | MCP, Agent | 代码生成工具、AI编程      |
| 商业智能       | 数据分析     | 商业数据分析和洞察                           | Agent      | 商业分析工具、数据分析    |
|                | 报表生成     | 自动生成商业报表                             | Agent      | 报表工具、报表生成器      |
|                | 预测分析     | 业务趋势预测和分析                           | Agent      | 预测模型、趋势分析        |
|                | 数据挖掘     | 从数据中发现模式和规律                       | Agent      | 数据挖掘工具、模式识别    |
| 客户服务       | 客服机器人   | 自动客服和问答系统                           | Agent      | 聊天机器人、客服系统      |
|                | 语音客服     | 语音交互客服系统                             | Agent      | 语音客服、电话客服        |
|                | 工单管理     | 工单创建、跟踪和处理                         | Agent      | 工单系统、问题跟踪        |
|                | 客户分析     | 客户行为分析和画像                           | Agent      | 客户分析工具、用户画像    |
| 教育科技       | 智能辅导     | 个性化学习辅导和建议                         | Agent      | 学习助手、智能辅导        |
|                | 自动评分     | 作业和考试自动评分                           | Agent      | 自动评分工具、作业批改    |
|                | 学习分析     | 学习行为分析和评估                           | Agent      | 学习分析工具、学习评估    |
|                | 内容推荐     | 个性化学习内容推荐                           | Agent      | 学习推荐、内容推荐        |
| 医疗健康       | 诊断辅助     | 医疗诊断辅助和建议                           | Agent      | 诊断助手、医疗AI          |
|                | 健康监测     | 健康数据监测和分析                           | Agent      | 健康监测工具、健康分析    |
|                | 药物管理     | 药物信息查询和管理                           | MCP, Agent | 药物数据库、用药助手      |
|                | 医疗影像     | 医疗影像分析和识别                           | Agent      | 影像分析、医学影像        |
| 金融服务       | 风险评估     | 金融风险分析和评估                           | Agent      | 风险评估模型、信用评估    |
|                | 交易策略     | 自动化交易策略执行                           | Agent      | 交易算法、量化交易        |
|                | 财务分析     | 财务数据分析和报告                           | Agent      | 财务分析工具、报表分析    |
|                | 支付处理     | 支付接口和处理服务                           | MCP        | 支付API、支付网关         |
| 法律科技       | 合同审查     | 合同条款分析和审查                           | Agent      | 合同审查工具、法律分析    |
|                | 法律检索     | 法律文献和案例检索                           | Agent      | 法律检索工具、案例搜索    |
|                | 合规检查     | 合规性检查和评估                             | Agent      | 合规工具、合规检查        |
|                | 法律咨询     | 法律问题咨询和建议                           | Agent      | 法律助手、法律咨询        |
| 供应链管理     | 库存管理     | 库存优化和管理                               | Agent      | 库存管理系统、库存优化    |
|                | 物流调度     | 物流路线优化和调度                           | Agent      | 物流优化、路径规划        |
|                | 需求预测     | 需求预测和计划                               | Agent      | 需求预测模型、销售预测    |
|                | 供应商管理   | 供应商评估和管理                             | Agent      | 供应商管理、采购管理      |
| 环境监测       | 天气查询     | 天气信息查询和预报                           | MCP, Agent | 天气API、天气预报         |
|                | 环境监测     | 环境数据监测和分析                           | MCP, Agent | 环境监测工具、污染检测    |
|                | 气候分析     | 气候数据分析和预测                           | Agent      | 气候分析、气象分析        |
| 社交媒体       | 内容发布     | 社交媒体内容发布                             | MCP, Agent | 社交媒体API、内容发布     |
|                | 社交分析     | 社交媒体数据分析和洞察                       | Agent      | 社交分析工具、舆情分析    |
|                | 用户管理     | 社交媒体用户管理                             | MCP, Agent | 用户管理API、粉丝管理     |
| 电商服务       | 商品管理     | 商品信息管理和更新                           | MCP, Agent | 商品管理API、库存管理     |
|                | 订单处理     | 订单创建、查询和处理                         | MCP, Agent | 订单API、订单管理         |
|                | 价格监控     | 商品价格监控和分析                           | Agent      | 价格监控工具、比价服务    |
|                | 推荐系统     | 商品推荐和个性化                             | Agent      | 商品推荐、个性化推荐      |
| 游戏开发       | NPC行为      | 游戏NPC行为控制                              | Agent      | NPC AI、行为树            |
|                | 关卡生成     | 游戏关卡自动生成                             | Agent      | 关卡生成、程序化生成      |
|                | 游戏分析     | 游戏数据分析                                 | Agent      | 游戏分析工具、玩家分析    |
| 物联网         | 设备管理     | IoT设备管理和监控                            | MCP, Agent | 设备管理平台、IoT管理     |
|                | 数据采集     | IoT设备数据采集                              | MCP        | 数据采集工具、传感器数据  |
|                | 设备控制     | IoT设备远程控制                              | MCP, Agent | 设备控制API、远程控制     |
| 其他工具       | 工具集成     | 多种工具的集成和组合                         | MCP, Agent | 工具集成平台、工作流工具  |
|                | 实用工具     | 各种实用小工具                               | MCP, Agent | 工具集合、实用工具        |
|                | 实验性       | 实验性功能和工具                             | MCP, Agent | 实验工具、测试功能        |

**提示词参考**

服务发现⼯具启动提示：

搜索并安装 智能体服务或MCP服务，根据关键词查找匹配的 服务，返回相似度最⾼的前N条记录，每条记录包含服务信息、端点地址和安装状态。本⼯具集成了搜索和安装功能，搜索到服务后会⾃动验证服务状态并返回端点地址，可以直接使⽤。⚠️ 重要提示：1) 关键词分隔符：推荐使⽤逗号（,）分隔多个关键词，特别是中英⽂关键词混合时，例如：\"数据产品,data product\" 或 \"上架,publish\"。也⽀持空格、分号、竖线作为分隔符。2) 为了获得更好的搜索结果，请提供中⽂关键词，优先使⽤地区信息、节点信息和功能信息，例如：\"上海,业务节点,标识解析\" 或 \"北京,区域节点,数据产品上架\"。如果⽤户给出的地区信息、节点信息或功能描述不明确，最好再次询问⽤户确认具体信息。

服务发现⼯具调⽤后提示：

调⽤智能体服务或MCP服务请确保提供正确的认证信息（Authorization Bearer token），查看是否需要进⾏身份认证并在调⽤前先完成身份认证，否则请求调⽤失败⚠️ 重要提示：1) 身份认证需要⽤户与服务进⾏挑战应答。2）挑战应答需要调⽤⼯具触发客户端，查看authentication.instructions获取挑战应答认证说明，指导客户端如何获取和使⽤认证信息。

3）完成挑战后客户端会给出token，每次调⽤都需要将token组装在请求的请求头中，格式为Authorization Bearer类型。

智能体授权与使⽤记录接⼝定义

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IAAS - Agent Authorization Standard Interface
 * @notice 智能体授权标准接口
 * @dev 参考ERC-20标准格式设计，支持链下调用+链上结算模式
 */
interface IAAS {
    /* ======= STRUCTS & ENUMS ======= */
    /**
    * @notice 支票状态枚举
    */
    enum Status {
    ACTIVE,    // 可操作
    PAUSED,    // 已暂停
    COMPLETED,    // 已完成（额度用完）
    EXPIRED,    // 已过期
    REVOKED    // 已撤销
    }

    /**
    * @notice 支票结构
    */
    struct Check {
    bytes32 checkId;    // 支票唯一标识
    address user;    // 用户地址
    address agent;    // 智能体地址
    address token;    // 代币合约地址
    uint256 totalAmount;    // 总授权金额
    uint256 remainingAmount;    // 剩余可用金额
    uint256 createdAt;    // 创建时间戳
    uint256 expiresAt;    // 过期时间戳
    Status status;    // 当前状态
    }

    /**
    * @notice 结算记录结构
```

```solidity
*/
struct Settlement {
    bytes32 settlingId; // 结算记录ID
    bytes32 checkId; // 关联支票ID
    address claimer; // 兑现方地址（智能体）
    address service; // 服务提供方地址
    uint256 amount; // 结算金额
    uint256 timestamp; // 结算时间戳
    string purpose; // 用途说明
    bytes32 proofHash; // 链下证明哈希
}

/**
 * @notice 签名授权结构（支持预签名）
 */
struct SignedSettlement {
    bytes32 checkId; // 支票ID
    address service; // 服务方地址
    uint256 amount; // 结算金额
    uint256 validFrom; // 生效时间
    uint256 validTo; // 过期时间
    bytes32 contextHash; // 上下文哈希
    bytes signature; // 用户签名
}

/* ====== EVENTS ====== */

/**
 * @notice 支票创建事件
 */
event CheckCreated(
    bytes32 indexed checkId,
    address indexed user,
    address indexed agent,
    address token,
    uint256 totalAmount,
    uint256 expiresAt
);

/**
 * @notice 支票兑现事件
 */
event CheckCashed(
    bytes32 indexed settlementId,
    bytes32 indexed checkId,
```

```txt
address indexed service,
address claimer,
uint256 amount,
uint256 remainingAmount,
bytes32 proofHash

/**
 * @notice 支票状态变更事件
 */
event CheckStatusChanged(
    bytes32 indexed checkId,
    Status oldStatus,
    Status newStatus
);

/**
 * @notice 支票撤销事件
 */
event CheckRevoked(
    bytes32 indexed checkId,
    address revokedBy,
    uint256 refundAmount
);

/* ======== CORE FUNCTIONS ======== */

/**
 * @notice 创建支票
 * @param agent 智能体地址
 * @param token 代币合约地址
 * @param totalAmount 总授权金额
 * @param duration 有效期（秒）
 * @return checkId 生成的支票ID
 */
function createCheck(
    address agent,
    address token,
    uint256 totalAmount,
    uint256 duration
) external returns (bytes32 checkId);

/**
 * @notice 兑现支票
 * @param checkId 支票ID
```

```solidity
* @param service 服务提供方地址
* @param amount 结算金额
* @param purpose 用途说明
* @param proofHash 链下证明哈希
* @return settlingId 结算记录ID
*/
function cashCheck(
    bytes32 checkId,
    address service,
    uint256 amount,
    string calldata purpose,
    bytes32 proofHash
) external returns (bytes32 settlingId);

/**
 * @notice 使用签名兑现支票
 * @param signed 签名授权结构
 * @param purpose 用途说明
 * @return settlingId 结算记录ID
 */
function cashCheckWithSignature(
    SignedSettlement calldata signed,
    string calldata purpose
) external returns (bytes32 settlingId);

/* ======= VIEW FUNCTIONS ======= */

/**
 * @notice 获取支票详情
 * @param checkId 支票ID
 * @return Check 支票结构
 */
function getCheck(bytes32 checkId) external view returns (Check memory);

/**
 * @notice 获取结算记录
 * @param settlingId 结算记录ID
 * @return Settlement 结算记录结构
 */
function getSettlement(bytes32 settlementId) external view returns (Settlement memory);

/**
 * @notice 获取支票所有结算记录
```

```javascript
* @param checkId 支票ID
* @return Settlement[] 结算记录数组
*/
function getCheckSettlements(bytes32 checkId) external view returns (Settlement[] memory);

/**
 * @notice 查询支票剩余额度
 * @param checkId 支票ID
 * @return uint256 剩余可用金额
 */
function remainingBalance(bytes32 checkId) external view returns (uint256);

/**
 * @notice 检查支票是否可兑现
 * @param checkId 支票ID
 * @param amount 拟兑现金额
 * @return (bool, string) (是否可用，原因说明)
 */
function canCashCheck(bytes32 checkId, uint256 amount) external view returns (bool, string memory);

/* ======== MANAGEMENT FUNCTIONS ======== */

/**
 * @notice 撤销支票
 * @param checkId 支票ID
 * @return refundAmount 退回金额
 */
function revokeCheck(bytes32 checkId) external returns (uint256 refundAmount);

/**
 * @notice 暂停支票
 * @param checkId 支票ID
 */
function pauseCheck(bytes32 checkId) external;

/**
 * @notice 恢复支票
 * @param checkId 支票ID
 */
function resumeCheck(bytes32 checkId) external;
```

```solidity
/**
 * @notice 更新支票有效期
 * @param checkId 支票ID
 * @param newExpiresAt 新过期时间戳
 */
function updateCheckExpiry(bytes32 checkId, uint256 newExpiresAt)
external;
}

/**
 * @title IAASMetadata - 元数据扩展接口
 */
interface IAASMetadata {
    /**
    * @notice 获取支票名称
    * @param checkId 支票ID
    * @return string 名称
    */
    function checkName(bytes32 checkId) external view returns (string memory);

    /**
    * @notice 获取支票描述
    * @param checkId 支票ID
    * @return string 描述
    */
    function checkDescription(bytes32 checkId) external view returns (string memory);

    /**
    * @notice 获取支票元数据URI
    * @param checkId 支票ID
    * @return string URI
    */
    function checkURI(bytes32 checkId) external view returns (string memory);
}

/**
 * @title IAASBatch - 批量操作扩展接口
 */
interface IAASBatch {
    /**
    * @notice 批量创建支票
    * @param agents 智能体地址数组
```

```solidity
* @param token 代币合约地址
* @param amounts 金额数组
* @param duration 有效期（秒）
* @return checkIds 支票ID数组
*/
function batchCreateCheck(
    address[] calldata agents,
    address token,
    uint256[] calldata amounts,
    uint256 duration
) external returns (bytes32[] memory checkIds);

/**
 * @notice 批量兑现支票
 * @param checkIds 支票ID数组
 * @param services 服务方地址数组
 * @param amounts 金额数组
 * @param purposes 用途说明数组
 * @param proofHashes 证明哈希数组
 * @return settlementIds 结算记录ID数组
 */
function batchCashCheck(
    bytes32[] calldata checkIds,
    address[] calldata services,
    uint256[] calldata amounts,
    string[] calldata purposes,
    bytes32[] calldata proofHashes
) external returns (bytes32[] memory settlementIds);
}

/**
 * @title IAASPermit - 签名授权扩展接口
 */
interface IAASPermit {
    /**
    * @notice 通过签名创建支票
    * @param user 用户地址
    * @param agent 智能体地址
    * @param token 代币合约地址
    * @param totalAmount 总金额
    * @param duration 有效期（秒）
    * @param deadline 签名过期时间
    * @param v 签名v
    * @param r 签名r
    * @param s 签名s
```

```javascript
* @return checkId 支票ID
*/
function createCheckBySignature(
    address user,
    address agent,
    address token,
    uint256 totalAmount,
    uint256 duration,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external returns (bytes32 checkId);
```

/**
