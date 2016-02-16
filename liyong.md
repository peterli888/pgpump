#原作者实现的:
- 实现了tcp代理,但是需要pg是master/slave架构,通过定时的健康检查,可以发现failover,但是没有相应的数据恢复策略.
- 代理的实现是 WorkerPump.prototype.start 函数里面的pipe
#改进:
- 需要分析pg的nodejs模块的connection.js的分析部分,解析出一个sql语句的组成部分,然后进行相应的策略.
#目标:
- 一个节点为主节点,其他节点也是主节点
- create/insert/update/delete语句需要在 main节点进行,成功后在每一个进行,
- 每条语句记录,有宕机的专门记录下来,待他再开机时逐条sql执行
- select语句进行负载均衡,按照权重分到各个节点进行
