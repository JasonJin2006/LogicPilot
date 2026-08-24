// Comprehensive SysML v2 exercise file: every construct of the Workbench's
// visual subset in one document, so diagram coverage can be checked by
// opening a single file. Pairs with the parser's conformance matrix
// (sysmlExecution.ts). Relation endpoints use bare ASCII identifiers (the
// relation-statement grammar); display names elsewhere may be quoted.
// Sequence/interaction diagrams and table views are OUTSIDE the subset and
// intentionally absent.

package '综合示例' {

    private import ScalarValues::*;

    doc /*
    覆盖范围：包嵌套、枚举、属性与多重度、部件定义/用法、特化、条目、
    端口、接口、连接、需求与满足/追踪、动作、计算、状态机与时间触发、
    约束、用例、视图/视点、利益相关方、发生、流、分配、绑定、
    引号标识符、多行 transition、doc 注释。
    */

    enum def '优先级' {
        '高';
        '中';
        '低';
    }

    attribute def '质量属性' {
        attribute '数值' : ScalarValues::Real;
        attribute '单位' : String;
    }

    part def '传感器' {
        attribute '采样频率' : ScalarValues::Real [1..*] = 100.0;
        port '数据输出';
    }

    part def '智能传感器' :> '传感器' {
        attribute '滤波系数' : ScalarValues::Real = 0.25;
    }

    item def '测量报告';

    port def DataPort;

    interface def '传感接口' {
        port DataPort;
    }

    part EnvSensor : '智能传感器' {
        port '数据输出';
        exhibit state '工作状态';
    }

    part Gateway {
        port DataPort;
    }

    connect EnvSensor to Gateway;

    stakeholder '运维工程师';

    occurrence '示范运行';

    requirement '数据要求' {
        doc /* 采样数据必须实时上传。 */
        attribute '最小频率' : ScalarValues::Real = 50.0;
    }

    requirement '系统需求';

    part MonitorSystem;

    action def '采集数据' {
        attribute '次数' : ScalarValues::Integer = 3;
        first start then '执行采样';
    }

    calculation def CalcTask {
        attribute '输入' : ScalarValues::Real = 90.0;
        attribute '输出' : ScalarValues::Real = 45.0;
    }

    action '执行采集' : '采集数据';

    state '巡检状态机' {
        attribute '轮次' : ScalarValues::Integer = 0;
        state '初始化';
        state '采样';
        state '上传';
        state '待机';
        transition '初始化' then '采样';
        transition '采样' then '上传' after 5 s;
        transition '上传' then '待机' at 60;
        transition '待机' then '采样' after 10 s;
    }

    state '工作状态' {
        entry; then action '进入工作';
        state '在线';
        state '离线';
        transition '在线' then '离线' after 30 s;
        transition '离线' then '在线' after 2 s;
    }

    action '进入工作' {
        attribute '就绪' : ScalarValues::Integer = 1;
    }

    constraint '频率下限' {
        '采样频率' >= '最小频率'
    }

    usecase '远程巡检';

    allocate CalcTask to Gateway;

    view '系统总览' {
        exhibit part MonitorSystem;
    }

    viewpoint '运行视点' {
        stakeholder '运维工程师';
    }

    analysis '频率分析';
    verification '需求验证案例';

    interaction def '数据上传场景' {
        actor Operator;
        actor SensorUnit;
        actor DataSink;
        message '上传请求' from Operator to SensorUnit;
        message '采样数据' from SensorUnit to DataSink;
        reply '确认回执' from DataSink to Operator;
    }
}
