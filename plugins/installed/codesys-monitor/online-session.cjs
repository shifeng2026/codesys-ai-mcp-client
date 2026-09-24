'use strict';

// Persistent CODESYS online session.
//
// Why a long-lived process instead of the one-process-per-action model the rest
// of the engine uses: an online connection lives inside the CODESYS process that
// opened it. If `login` returned and its process exited, the connection would die
// with it and `logout`/`download` would have nothing to act on. So the first
// online action starts ONE `--noUI` worker that opens the project once and then
// serves commands over files until it is told to quit.
//
// The worker is the only place that touches a controller. Host and worker speak
// through a single command file plus numbered result files; stdio goes to log
// files (not pipes) so nothing depends on the host relaying output.
//
// 两种"登录"，语义不同，别混：
//   login  → connect() + login(OnlineChangeOption.Keep)：只登录、不下载、不在线修改
//            （登录模式记作 'keep'）。在线变量（monitor）用它，所以点「登录」就能看到值。
//   download / online-change → login(Never) / login(Try)：会真的改动设备上的程序
//            （登录模式记作 'transfer'）。启停/复位/写变量/Force 只认这一种。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ONLINE_COMMANDS = Object.freeze([
  'status', 'login', 'logout', 'download', 'monitor', 'set-target', 'scan',
  'online-change', 'start', 'stop', 'reset', 'write-variable', 'force', 'unforce', 'quit',
]);

function jsonLiteral(value) {
  // JSON strings are valid IronPython string literals; the raw-string prefix is
  // unnecessary and would break on Windows backslashes.
  return JSON.stringify(String(value));
}

function buildOnlineWorkerScript(workDir, projectPath, options = {}) {
  const work = jsonLiteral(path.resolve(workDir));
  const project = jsonLiteral(path.resolve(projectPath));
  const maxIdleSeconds = Math.max(60, Number(options.maxIdleSeconds) || 600);
  // Result files are namespaced per session run. Sequence numbers restart at 1 on
  // every start, so without a run token a stale result from a previous session in
  // the same directory would be read back as this session's answer — which once
  // made a `monitor` call return the previous run's `quit` receipt.
  const resultPrefix = jsonLiteral(String(options.resultPrefix || 'online-result-'));
  // 目录里的**每一个**交换文件都带运行令牌。只给结果文件加令牌是不够的：命令文件
  // 同名时，一个"上次崩溃没退干净、还在等命令"的旧进程会和新进程抢同一个命令文件，
  // 同一条 login / download 会被执行两次。带上令牌之后，旧进程只会看着自己的文件，
  // 谁也命令不动它，它就按自己的空闲上限退出。
  const tokenSuffix = jsonLiteral(String(options.runToken || '').trim());
  return `# -*- coding: utf-8 -*-
# TaskHive CODESYS online worker. Read-only toward the project file: it opens a
# copy, and only ever acts on a controller through the actions below.
import json
import os
import sys
import time
import traceback

WORK = ${work}
PROJECT = ${project}
MAX_IDLE_SECONDS = ${maxIdleSeconds}
RUN_TOKEN = ${tokenSuffix}
# 在线变量逐条读取的上限与总预算（见 do_monitor）：批量读失败时才走逐条，且必须有
# 上限，否则一次 monitor 就能把串行命令队列占满好几秒。
MONITOR_PER_EXPRESSION_MAX = 24
MONITOR_PER_EXPRESSION_BUDGET_SECONDS = 4.0

COMMAND_PATH = os.path.join(WORK, 'online-command' + RUN_TOKEN + '.json')
READY_PATH = os.path.join(WORK, 'online-ready' + RUN_TOKEN + '.json')
PROGRESS_PATH = os.path.join(WORK, 'online-progress' + RUN_TOKEN + '.json')
STOP_PATH = os.path.join(WORK, 'online-stop' + RUN_TOKEN)
RESULT_PREFIX = ${resultPrefix}


def result_path_for(seq):
    return os.path.join(WORK, RESULT_PREFIX + str(seq) + '.json')


def write_json(target, value):
    parent = os.path.dirname(target)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    temp = target + '.tmp'
    handle = open(temp, 'wb')
    try:
        handle.write(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode('utf-8'))
    finally:
        handle.close()
    try:
        if os.path.exists(target):
            os.remove(target)
    except Exception:
        pass
    os.rename(temp, target)


def read_json(target):
    handle = open(target, 'rb')
    try:
        return json.loads(handle.read().decode('utf-8'))
    finally:
        handle.close()


def text(value):
    try:
        return str(value)
    except Exception as error:
        return '<err %s>' % error


def enum_text(value):
    try:
        return '%s (%s)' % (text(value), int(value))
    except Exception:
        return text(value)


def find_root_device(project):
    roots = list(project.get_children(False) or [])
    for candidate in roots:
        try:
            if bool(getattr(candidate, 'is_device', False)):
                return candidate, 'root-is-device'
        except Exception:
            pass
    for candidate in (project.get_children(True) or []):
        try:
            if bool(getattr(candidate, 'is_device', False)):
                return candidate, 'flat-scan-is-device'
        except Exception:
            pass
    return None, 'not-found'


def device_object_of(device):
    # IScriptDeviceObject carries address / gateway / device identification, but
    # IronPython's hasattr() is unreliable on these proxies, so every documented
    # route is attempted and the one that worked is reported for audit.
    for attribute in ('get_device_object', 'device_object'):
        try:
            value = getattr(device, attribute)
        except Exception:
            continue
        try:
            value = value() if callable(value) else value
        except Exception:
            continue
        if value is not None:
            return value, attribute
    for attribute in ('Extender', 'get_Extender'):
        try:
            value = getattr(device, attribute)
            value = value() if callable(value) else value
            if value is not None:
                return value, attribute
        except Exception:
            continue
    return device, 'device-itself'


def read_communication_settings(holder):
    # CODESYS' 通信设置 tab. This is the ONLY place the API exposes an actual IP
    # address + port: the scan-target list carries just the gateway node address
    # (e.g. "0301.3035"), never an IP.
    value = {'errors': []}
    settings = None
    for attribute in ('get_device_communication_settings', 'device_communication_settings'):
        try:
            candidate = getattr(holder, attribute)
            settings = candidate() if callable(candidate) else candidate
            value['route'] = attribute
            break
        except Exception as error:
            value['errors'].append('%s: %s' % (attribute, text(error)[:160]))
    if settings is None:
        return value
    for label, attribute in (('ipAddressAndPort', 'scanned_ip_address_and_port'),
                             ('scannedDeviceName', 'scanned_device_name'),
                             ('scannedTargetId', 'scanned_target_id'),
                             ('scannedTargetName', 'scanned_target_name'),
                             ('scannedTargetType', 'scanned_target_type'),
                             ('scannedTargetVendor', 'scanned_target_vendor'),
                             ('scannedTargetVersion', 'scanned_target_version')):
        try:
            item = getattr(settings, attribute)
            value[label] = text(item() if callable(item) else item)
        except Exception as error:
            value['errors'].append('%s: %s' % (attribute, text(error)[:160]))
    return value


def read_target(device):
    # Everything here is a READ of the project's configured target. It runs before
    # any connection, which is what lets the operator see WHERE a login would go.
    target = {
        'deviceName': text(device.get_name()),
        'deviceType': text(getattr(device, 'type', '')),
        'deviceGuid': text(getattr(device, 'guid', '')),
        'address': '',
        'gatewayGuid': '',
        'deviceIdentification': '',
        'deviceIdentificationVersion': '',
        'simulationMode': '',
        'targetRoute': '',
        'targetErrors': [],
    }
    holder, route = device_object_of(device)
    target['targetRoute'] = route
    try:
        simulation = getattr(holder, 'get_simulation_mode')
        target['simulationMode'] = text(simulation() if callable(simulation) else simulation)
    except Exception:
        try:
            target['simulationMode'] = text(getattr(holder, 'simulation'))
        except Exception as error:
            target['targetErrors'].append('simulation: %s' % text(error))
    for label, attribute in (('address', 'get_address'),
                             ('gatewayGuid', 'get_gateway'),
                             ('deviceIdentification', 'get_device_identification')):
        try:
            value = getattr(holder, attribute)
            value = value() if callable(value) else value
            if label == 'deviceIdentification' and value is not None:
                target['deviceIdentification'] = text(getattr(value, 'id', ''))
                target['deviceIdentificationVersion'] = text(getattr(value, 'version', ''))
                target['deviceIdentificationType'] = text(getattr(value, 'type', ''))
            else:
                target[label] = text(value)
        except Exception as error:
            target['targetErrors'].append('%s: %s' % (attribute, text(error)))
    try:
        target['communicationSettings'] = read_communication_settings(holder)
    except Exception as error:
        target['communicationSettings'] = {'errors': [text(error)[:160]]}
    return target


def gateway_names():
    names = []
    try:
        for gateway in online.gateways:
            entry = {}
            for attribute in ('name', 'address', 'port', 'driver', 'id', 'guid'):
                try:
                    entry[attribute] = text(getattr(gateway, attribute))
                except Exception:
                    pass
            if not entry:
                entry['raw'] = text(gateway)
            names.append(entry)
    except Exception as error:
        names.append({'error': text(error)})
    return names


def device_children(device):
    names = []
    try:
        for child in (device.get_children(False) or []):
            try:
                names.append(text(child.get_name()))
            except Exception:
                pass
    except Exception:
        pass
    return names[:40]


state = {
    'project': None,
    'application': None,
    'device': None,
    'onlineDevice': None,
    'onlineApplication': None,
    'deviceResolution': '',
    # '' 未登录；'keep' = 只登录、不传输（「登录」按钮）；'transfer' = 由「下载」或
    # 「在线修改」建立的登录（那两步才可能改动设备上的程序）。
    'loginMode': '',
}

try:
    state['project'] = project = projects.open(PROJECT)
    state['application'] = project.active_application
    device, resolution = find_root_device(project)
    state['deviceResolution'] = resolution
    if device is None:
        raise Exception('No device object found in project')
    state['device'] = device
    state['onlineDevice'] = online.create_online_device(device)
    # Read the configured target BEFORE any connection: this is what the operator
    # checks to know which controller a login would reach.
    target = read_target(device)
    write_json(READY_PATH, {
        'ok': True,
        'pid': os.getpid(),
        'projectPath': text(project.path),
        'application': text(project.active_application.get_name()) if project.active_application is not None else '',
        'deviceName': text(device.get_name()),
        'deviceType': text(getattr(device, 'type', '')),
        'deviceGuid': text(getattr(device, 'guid', '')),
        'deviceResolution': resolution,
        'deviceChildren': device_children(device),
        'target': target,
        'gateways': gateway_names(),
        'safetyMode': 'online-worker-keep-login-read-only-monitor',
        'deniedOnlineCapabilities': ['online-change', 'write-variable', 'start', 'stop', 'reset',
                                     'debug', 'breakpoint', 'step', 'force'],
    })
except Exception:
    write_json(READY_PATH, {'ok': False, 'error': traceback.format_exc(), 'pid': os.getpid()})
    sys.exit(1)


def online_application():
    if state['onlineApplication'] is None:
        state['onlineApplication'] = online.create_online_application(state['application'])
    return state['onlineApplication']


# ApplicationState 是枚举（单值），OperatingState 是**位标志**。后者才是现场最需要的
# 信息：有没有 Force 生效、是不是做过在线修改、retain 是否不匹配、开机程序是否有效。
APPLICATION_STATE_LABELS = {
    0: '未启动', 1: '运行中（RUN）', 2: '已停止（STOP）', 3: '停在断点',
    4: '调试单步', 5: '单周期', 255: '系统应用', 4294967295: '未知',
}
OPERATING_STATE_FLAGS = [
    (1, '程序已加载'), (2, '正在下载'), (4, '做过在线修改'), (8, '正在写入开机程序'),
    (16, '有强制生效'), (32, '应用异常'), (64, '下载后自动运行'), (128, '仅写开机程序'),
    (256, '正在退出'), (512, '正在删除'), (1024, '正在复位'), (2048, '保持变量不匹配'),
    (4096, '开机程序有效'), (8192, '正在加载开机程序'), (16384, '程序流激活'),
    (32768, 'Flash 中运行'), (131072, '核心转储已加载'), (262144, '执行点激活'),
    (524288, '正在生成核心转储'),
]
# 这三类必须让操作者一眼看到，不能只藏在 tooltip 里。
OPERATING_STATE_WARNINGS = ('有强制生效', '应用异常', '保持变量不匹配')


def decode_states(application):
    value = {}
    try:
        state_value = application.application_state
        code = int(state_value)
        value['applicationStateCode'] = code
        value['applicationState'] = enum_text(state_value)
        value['applicationStateLabel'] = APPLICATION_STATE_LABELS.get(code, text(state_value))
    except Exception:
        pass
    try:
        state_value = application.operation_state
        raw = int(state_value)
        value['operationStateCode'] = raw
        value['operationState'] = enum_text(state_value)
        flags = [label for bit, label in OPERATING_STATE_FLAGS if raw & bit]
        value['operationFlags'] = flags
        value['operationWarnings'] = [item for item in flags if item in OPERATING_STATE_WARNINGS]
    except Exception:
        pass
    return value


def connection_state():
    value = {}
    try:
        value['connected'] = bool(state['onlineDevice'].connected)
    except Exception as error:
        value['connectedError'] = text(error)
    try:
        value['sharedConnected'] = bool(state['onlineDevice'].shared_connected)
    except Exception:
        pass
    try:
        value['loggedOnUsername'] = text(state['onlineDevice'].current_logged_on_username)
    except Exception:
        pass
    try:
        application = online_application()
        value['isLoggedIn'] = bool(application.is_logged_in)
        value.update(decode_states(application))
    except Exception as error:
        value['isLoggedInError'] = text(error)
    # 登录是"怎么来的"必须能被界面看见：只有 transfer 登录才允许启停/复位/写变量/
    # Force（见 require_logged_in），keep 登录只够用来读在线变量。
    value['loginMode'] = state.get('loginMode', '')
    return value


def do_login(args):
    # 「登录」= 建立设备连接 + **登录到应用**，但只登录、不传输任何东西：
    #   OnlineChangeOption.Keep 的官方定义（ScriptEngine 帮助，OnlineChangeOption
    #   枚举）就是 "Try to login. Do not online update. Do not download. Keep as
    #   it is." —— 协议层不可能把程序写进设备，却能让 is_logged_in 变真。
    #   而 is_logged_in 正是在线变量（monitor）能读值的前提：此前这里只
    #   connect()（不登录应用），所以界面"登录上了却一个在线值都没有"。
    #   Never / Try 属于「下载」「在线修改」两个独立且单独授权的动作，绝不出现在这里。
    if not state['onlineDevice'].connected:
        state['onlineDevice'].connect()
    result = connection_state()
    if result.get('isLoggedIn') is not True:
        try:
            online_application().login(OnlineChangeOption.Keep, False)
            state['loginMode'] = 'keep'
        except Exception as error:
            # 登录失败不能让"设备已连接"这个事实消失：连接本身是成功的，失败的是
            # 应用层登录（设备上没有应用、被拒绝等），分开报出来才能定位。
            result['applicationLoginError'] = text(error)
    # Confirm, after the connection exists, that the target is still the one the
    # operator was shown. A reader that fails here is reported rather than hidden.
    try:
        result['target'] = read_target(state['device'])
    except Exception as error:
        result['targetError'] = text(error)
    result.update(connection_state())
    return result


def do_logout(args):
    result = {}
    try:
        application = online_application()
        if bool(application.is_logged_in):
            application.logout()
            result['applicationLoggedOut'] = True
    except Exception as error:
        result['applicationLogoutError'] = text(error)
    state['loginMode'] = ''
    try:
        if state['onlineDevice'].connected:
            state['onlineDevice'].disconnect()
            result['deviceDisconnected'] = True
    except Exception as error:
        result['deviceDisconnectError'] = text(error)
    result.update(connection_state())
    return result


def do_download(args):
    application = online_application()
    before = connection_state()
    result = {'before': before, 'onlineChangeOption': 'Never', 'deleteForeignApps': False}
    # OnlineChangeOption.Never is the only admissible option: Try/Force attempt
    # an online change, which is a permanently denied capability here.
    if bool(application.is_logged_in):
        application.logout()
        result['reloggedIn'] = True
    application.login(OnlineChangeOption.Never, False)
    state['loginMode'] = 'transfer'
    result['after'] = connection_state()
    result['target'] = read_target(state['device'])
    return result


def do_set_target(args):
    # Point THIS session at another gateway/target. The project the worker holds is
    # a throwaway copy that is never saved, so this changes where a login goes
    # without touching the operator's real .project.
    #
    # 两种寻址方式：
    #   address 模式 —— set_gateway_and_address(网关, 节点地址)   例如 0301.3035
    #   ip 模式      —— set_gateway_and_ip_address(网关, IP[, 端口])
    # 注意：ip 模式**没有对应的 getter**，设完读不回来；read_target() 里的
    # get_address() 也不会反映它。能不能生效只能靠随后真的连一次来判断。
    if bool(state['onlineDevice'].connected):
        raise Exception('已连接状态下不能更改目标，请先「断开」')
    address = text(args.get('address', '')).strip()
    ip_address = text(args.get('ipAddress', '')).strip()
    gateway_name = text(args.get('gatewayName', '')).strip()
    gateway_guid = text(args.get('gatewayGuid', '')).strip()
    if not gateway_name and not gateway_guid:
        raise Exception('请选择网关')
    try:
        port = int(args.get('port') or 0)
    except Exception:
        port = 0
    holder, route = device_object_of(state['device'])
    attempts = []
    if ip_address:
        if gateway_name:
            attempts.append(('ip:String', lambda: holder.set_gateway_and_ip_address(gateway_name, ip_address)))
            if port:
                attempts.append(('ip:String,port', lambda: holder.set_gateway_and_ip_address(gateway_name, ip_address, port)))
        if gateway_guid:
            attempts.append(('ip:Guid', lambda: holder.set_gateway_and_ip_address(Guid(gateway_guid), ip_address)))
    else:
        if not address:
            raise Exception('设备地址或 IP 不能为空')
        if gateway_name:
            attempts.append(('name', lambda: holder.set_gateway_and_address(gateway_name, address)))
        if gateway_guid:
            attempts.append(('guid', lambda: holder.set_gateway_and_address(Guid(gateway_guid), address)))
    applied = ''
    errors = []
    for label, call in attempts:
        try:
            call()
            applied = label
            break
        except Exception as error:
            errors.append('%s: %s' % (label, text(error)))
    if not applied:
        raise Exception('设置目标失败：' + ' | '.join(errors))
    result = {
        'applied': applied,
        'targetMode': 'ip' if ip_address else 'address',
        'targetRoute': route,
        'requested': {
            'gatewayName': gateway_name,
            'gatewayGuid': gateway_guid,
            'address': address,
            'ipAddress': ip_address,
            'port': port,
        },
        'attemptErrors': errors,
        'saved': False,
        # ip 模式没有 getter，读回来的 address 仍是节点地址，这是预期行为。
        'readBackLimited': bool(ip_address),
    }
    result['target'] = read_target(state['device'])
    return result


def prop(obj, *names):
    # IronPython exposes .NET getters both as methods and as properties depending
    # on the interface, so try every spelling before giving up.
    for name in names:
        try:
            value = getattr(obj, name)
        except Exception:
            continue
        try:
            value = value() if callable(value) else value
        except Exception:
            continue
        return text(value)
    return ''


def do_scan(args):
    # This is CODESYS' own "scan network": the gateway broadcasts on the network
    # and reports the controllers it found. It contacts NO controller and changes
    # nothing; it only fills the picker with real devices instead of asking the
    # operator to type an IP.
    use_cache = args.get('useCache') is True
    gateways = []
    try:
        gateways = list(online.gateways)
    except Exception as error:
        raise Exception('无法枚举网关：' + text(error))
    if not gateways:
        raise Exception('本机没有已注册的 CODESYS 网关')
    results = []
    for gateway in gateways:
        entry = {
            'gatewayName': prop(gateway, 'name'),
            'gatewayGuid': prop(gateway, 'guid'),
            'address': prop(gateway, 'address'),
            'port': prop(gateway, 'port'),
            'devices': [],
            'errors': [],
        }
        try:
            if use_cache:
                raw = gateway.get_cached_network_scan_result()
                entry['source'] = 'cache'
            else:
                raw = gateway.perform_network_scan()
                entry['source'] = 'live'
            devices = list(raw or [])
            # A live broadcast can come back empty under --noUI (the gateway
            # replies are never pumped). Rather than showing the operator an empty
            # list, fall back to what the gateway already cached and say so.
            if not use_cache and not devices:
                try:
                    devices = list(gateway.get_cached_network_scan_result() or [])
                    if devices:
                        entry['source'] = 'cache-fallback'
                except Exception as error:
                    entry['errors'].append('cache fallback: ' + text(error)[:200])
            for device in devices:
                device_id = None
                try:
                    device_id = device.device_id
                except Exception:
                    device_id = None
                entry['devices'].append({
                    'name': prop(device, 'device_name'),
                    'type': prop(device, 'type_name'),
                    'vendor': prop(device, 'vendor_name'),
                    'address': prop(device, 'address'),
                    'parentAddress': prop(device, 'parent_address'),
                    'cached': prop(device, 'locked_in_cache'),
                    'deviceId': prop(device_id, 'id') if device_id is not None else '',
                    'deviceIdVersion': prop(device_id, 'version') if device_id is not None else '',
                })
        except Exception as error:
            entry['errors'].append(text(error)[:400])
        results.append(entry)
    return {
        'mode': 'cached' if use_cache else 'live',
        'gateways': results,
        'deviceCount': sum(len(item['devices']) for item in results),
        'scannedAt': time.time(),
    }


def require_logged_in():
    # start / stop / reset / 写变量 / Force 全部作用在应用层，而且会改变**设备上正在
    # 运行的那个程序**。所以它们要的是传输型登录（由「下载」或「在线修改」建立），
    # 不是「登录」按钮那种 Keep 登录：Keep 会话里连"设备里跑的是哪一版程序"都没确认
    # 过，不该在那里启停机械。读在线变量不需要这一步（monitor 直接用
    # online_application()），所以「登录」照样能显示值。
    application = online_application()
    if not bool(application.is_logged_in):
        raise Exception('尚未登录到应用：请先点「登录」（只登录、不传输）')
    if state.get('loginMode') != 'transfer':
        raise Exception('当前是「只登录、不传输」的在线监视会话：启动/停止/复位/写变量/Force 需要先执行一次「下载」或「在线修改」——那一步才会确认设备上的程序就是当前工程。')
    return application


def do_online_change(args):
    application = online_application()
    result = {'before': connection_state(), 'onlineChangeOption': 'Try', 'deleteForeignApps': False}
    # Try = 先尝试在线修改，失败再完整下载。这正是"在线修改"这项能力的语义
    # （Never 是纯下载，见 do_download）。
    application.login(OnlineChangeOption.Try, False)
    state['loginMode'] = 'transfer'
    result['after'] = connection_state()
    result['target'] = read_target(state['device'])
    return result


def do_start(args):
    application = require_logged_in()
    before = enum_text(application.application_state)
    application.start()
    return {'before': before, 'after': enum_text(application.application_state)}


def do_stop(args):
    application = require_logged_in()
    before = enum_text(application.application_state)
    application.stop()
    return {'before': before, 'after': enum_text(application.application_state)}


def do_reset(args):
    application = require_logged_in()
    option = text(args.get('resetOption') or 'warm').strip().lower()
    options = {'warm': ResetOption.Warm, 'cold': ResetOption.Cold, 'original': ResetOption.Original}
    if option not in options:
        raise Exception('不支持的复位类型：' + option)
    force_kill = args.get('forceKill') is True
    before = enum_text(application.application_state)
    application.reset(options[option], force_kill)
    return {
        'before': before,
        'after': enum_text(application.application_state),
        'resetOption': option,
        'forceKill': force_kill,
    }


def expression_scope(args):
    return text(args.get('scope', '')).strip()


# 同一个变量在应用作用域里可能有两种合法写法：GVL 里的全局量用裸名（HR_STATUS）就能
# 读到，PROGRAM 的局部量必须写成 实例名.变量（Jog.permit）。哪种有效取决于所选对象的
# 种类，而这只有脚本运行时才知道 —— 所以记住"上次哪种写法成功过"，没有记录时先试限定
# 名（对 GVL 同样成立），失败再退回裸名。读值走批量优先，所以第一次可能要两轮才稳。
def preferred_expression(expression, scope):
    known = state.get('expressionNames', {}).get(expression)
    if known:
        return known
    if scope and '.' not in expression and expression != scope:
        return scope + '.' + expression
    return expression


def expression_candidates(expression, scope):
    candidates = [preferred_expression(expression, scope)]
    alternatives = [expression]
    if scope and '.' not in expression and expression != scope:
        alternatives.append(scope + '.' + expression)
    for alternative in alternatives:
        if alternative and alternative not in candidates:
            candidates.append(alternative)
    return candidates


def remember_expression(expression, used):
    state.setdefault('expressionNames', {})[expression] = used


def normalize_assignments(args):
    scope = expression_scope(args)
    assignments = []
    for item in (args.get('assignments') or []):
        expression = text(item.get('expression', '')).strip()
        if not expression:
            continue
        assignments.append({
            'requested': expression,
            'expression': preferred_expression(expression, scope),
            'value': text(item.get('value', '')),
        })
        if len(assignments) >= 60:
            break
    if not assignments:
        raise Exception('没有要写入的表达式')
    return assignments


def prepare_assignments(application, args):
    # 写入 / 强制都要先把每个表达式定位到真正能用的写法，定位失败的必须报出来，
    # 不能"看着成功、其实什么都没写"。
    scope = expression_scope(args)
    assignments = normalize_assignments(args)
    for item in assignments:
        applied = False
        last_error = None
        for candidate in expression_candidates(item['requested'], scope):
            try:
                application.set_prepared_value(candidate, item['value'])
                remember_expression(item['requested'], candidate)
                item['expression'] = candidate
                applied = True
                break
            except Exception as error:
                last_error = error
        if not applied:
            raise Exception('无法定位变量 ' + item['requested'] + '：' + (text(last_error)[:200] if last_error else '未知原因'))
    return assignments


def do_write(args):
    # 一次性写值：先 prepare 再 apply。写入 ≠ 强制，程序下一周期会覆盖它。
    application = require_logged_in()
    assignments = prepare_assignments(application, args)
    application.write_prepared_values()
    return {
        'written': [item['expression'] for item in assignments],
        'count': len(assignments),
        'forced': False,
        'after': connection_state(),
    }


def do_force(args):
    # Force 会**覆盖程序输出**，是这 9 项里最危险的一个：它能绕过程序逻辑直接
    # 驱动输出。进入这里之前，主机侧已经要求逐字输入确认词。
    application = require_logged_in()
    assignments = prepare_assignments(application, args)
    application.force_prepared_values()
    try:
        forced = [text(x) for x in (application.get_forced_expressions() or [])]
    except Exception:
        forced = [item['expression'] for item in assignments]
    return {'forced': [item['expression'] for item in assignments], 'count': len(assignments), 'forcedExpressions': forced}


def do_unforce(args):
    # 取消强制是**安全方向**，所以不需要确认词；但仍要求 force 能力已授权。
    application = require_logged_in()
    try:
        before = [text(x) for x in (application.get_forced_expressions() or [])]
    except Exception:
        before = []
    application.unforce_all_values()
    try:
        after = [text(x) for x in (application.get_forced_expressions() or [])]
    except Exception:
        after = []
    return {'before': before, 'after': after, 'count': len(before)}


def do_monitor(args):
    # Reading online values. This is a READ: variable WRITES and Force are denied
    # capabilities and are never prepared or applied here. 只要应用已登录就能读 ——
    # 「登录」（Keep）建立的登录同样算数，这正是"登录后就能看在线值"的实现点。
    expressions = []
    for item in (args.get('expressions') or []):
        value = text(item).strip()
        if value and value not in expressions:
            expressions.append(value)
        if len(expressions) >= 120:
            break
    application = online_application()
    result = {
        'isLoggedIn': bool(application.is_logged_in),
        'expressions': expressions,
        'values': [],
        'errors': [],
        'readMode': '',
    }
    if not result['isLoggedIn'] or not expressions:
        return result
    scope = expression_scope(args)
    preferred = [preferred_expression(item, scope) for item in expressions]
    if preferred != expressions:
        result['resolvedExpressions'] = preferred
    values = None
    if len(expressions) > 1:
        try:
            values = list(application.read_values(preferred))
            result['readMode'] = 'batch'
            for index, item in enumerate(expressions):
                remember_expression(item, preferred[index])
        except Exception:
            values = None
    if values is None or len(values) != len(expressions):
        # 逐条读取是"每个表达式一次往返"：60 条就是 60 次往返，而常驻在线进程的命令
        # 队列是串行的 —— 界面上的"登录后卡顿"很大一部分就是这么来的。所以逐条回退
        # 必须有上限和总时间预算：读到多少返回多少，没读到的如实标出来，下一轮继续。
        # 逐条时顺便把"哪种写法能读到"试出来并记住，下一轮批量读就能一次成功。
        values = []
        read_mode = 'per-expression'
        deadline = time.time() + MONITOR_PER_EXPRESSION_BUDGET_SECONDS
        for index, expression in enumerate(expressions):
            if index >= MONITOR_PER_EXPRESSION_MAX or time.time() > deadline:
                values.append('')
                result['errors'].append({'expression': expression, 'error': '本轮未读取（逐条读取的数量上限或时间预算已到）'})
                continue
            value = None
            last_error = None
            for candidate in expression_candidates(expression, scope):
                try:
                    value = text(application.read_value(candidate))
                    remember_expression(expression, candidate)
                    break
                except Exception as error:
                    last_error = error
            if value is None:
                values.append('')
                result['errors'].append({'expression': expression, 'error': text(last_error)[:200] if last_error else '读取失败'})
            else:
                values.append(value)
        result['readMode'] = read_mode
        result['partial'] = len(result['errors']) > 0
    result['values'] = [text(value) for value in values]
    try:
        result['applicationState'] = enum_text(application.application_state)
    except Exception:
        pass
    return result


def do_status(args):
    return connection_state()


def handle(command, args):
    if command == 'status':
        return do_status(args)
    if command == 'login':
        return do_login(args)
    if command == 'logout':
        return do_logout(args)
    if command == 'download':
        return do_download(args)
    if command == 'monitor':
        return do_monitor(args)
    if command == 'set-target':
        return do_set_target(args)
    if command == 'scan':
        return do_scan(args)
    if command == 'online-change':
        return do_online_change(args)
    if command == 'start':
        return do_start(args)
    if command == 'stop':
        return do_stop(args)
    if command == 'reset':
        return do_reset(args)
    if command == 'write-variable':
        return do_write(args)
    if command == 'force':
        return do_force(args)
    if command == 'unforce':
        return do_unforce(args)
    raise Exception('Unsupported online command: ' + command)


last_seq = 0
last_command_at = time.time()
while True:
    if os.path.isfile(STOP_PATH):
        break
    if time.time() - last_command_at > MAX_IDLE_SECONDS:
        break
    payload = None
    try:
        if os.path.isfile(COMMAND_PATH):
            payload = read_json(COMMAND_PATH)
    except Exception:
        payload = None
    if payload:
        try:
            seq = int(payload.get('seq', 0))
        except Exception:
            seq = 0
        if seq > last_seq:
            last_seq = seq
            command = text(payload.get('command', ''))
            if command == 'quit':
                write_json(result_path_for(seq),
                           {'seq': seq, 'ok': True, 'command': 'quit', 'value': {'stopped': True}})
                break
            # 只有**用户发起**的命令才续期空闲计时。工作台每 10 秒的 status 轮询
            # 曾经每次续期，导致这个进程永不退出、一直占着一个 CODESYS 实例
            # （约 700 MB）。status 是纯读取，不该让会话长生不老。
            if command != 'status':
                last_command_at = time.time()
            write_json(PROGRESS_PATH, {'seq': seq, 'command': command, 'phase': 'started', 'at': time.time()})
            try:
                value = handle(command, payload.get('args') or {})
                write_json(result_path_for(seq),
                           {'seq': seq, 'ok': True, 'command': command, 'value': value})
            except Exception:
                write_json(result_path_for(seq),
                           {'seq': seq, 'ok': False, 'command': command, 'error': traceback.format_exc()})
    try:
        system.process_messageloop()
    except Exception:
        pass
    time.sleep(0.2)

try:
    if state['onlineDevice'] is not None:
        try:
            if bool(state['onlineDevice'].connected):
                state['onlineDevice'].disconnect()
        except Exception:
            pass
    if state['project'] is not None:
        try:
            state['project'].close()
        except Exception:
            pass
except Exception:
    pass
`;
}

class CodesysOnlineSession {
  constructor(options = {}) {
    this.exePath = options.exePath || '';
    this.profile = options.profile || '';
    this.maxIdleSeconds = Number(options.maxIdleSeconds) || 1800;
    this.spawnProcess = options.spawnProcess || spawn;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.child = null;
    this.workDir = '';
    this.seq = 0;
    this.ready = null;
    this.lastError = '';
    this.startedAt = '';
    this.resultPrefix = 'online-result-';
    // 三个文件名都在 start() 里按运行令牌定下来（见那里的说明）。
    this.runToken = '';
    this.commandPath = '';
    this.readyPath = '';
    this.stopPath = '';
  }

  get running() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  writeCommand(command, args = {}) {
    this.seq += 1;
    const seq = this.seq;
    const payload = { seq, command, args, at: new Date().toISOString() };
    fs.writeFileSync(this.commandPath, `${JSON.stringify(payload)}\n`, 'utf8');
    return seq;
  }

  resultPathFor(seq) {
    return path.join(this.workDir, `${this.resultPrefix}${seq}.json`);
  }

  async send(command, args = {}, timeoutMs = 120000) {
    if (!ONLINE_COMMANDS.includes(command)) throw Object.assign(new Error(`不支持的在线命令：${command}`), { code: 'CODESYS_ONLINE_COMMAND_INVALID' });
    if (!this.running) throw Object.assign(new Error(this.lastError || '在线会话未启动'), { code: 'CODESYS_ONLINE_SESSION_NOT_RUNNING' });
    const seq = this.writeCommand(command, args);
    const resultPath = this.resultPathFor(seq);
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 120000);
    while (Date.now() < deadline) {
      if (fs.existsSync(resultPath)) {
        let payload = null;
        try { payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { payload = null; }
        if (payload && payload.seq === seq) {
          if (payload.ok === true) return payload.value || {};
          const error = new Error(`在线动作 ${command} 失败：${String(payload.error || '').trim().split('\n').slice(-3).join(' | ').slice(0, 600)}`);
          error.code = 'CODESYS_ONLINE_COMMAND_FAILED';
          error.details = payload;
          throw error;
        }
      }
      if (!this.running) {
        throw Object.assign(new Error(this.lastError || `CODESYS 在线进程在 ${command} 期间退出`), { code: 'CODESYS_ONLINE_PROCESS_EXITED' });
      }
      await new Promise((resolve) => { setTimeout(resolve, 150); });
    }
    throw Object.assign(new Error(`在线动作 ${command} 超时（${Math.round(timeoutMs / 1000)} 秒）；进程仍在运行，状态未知，请在 CODESYS 中核对`), { code: 'CODESYS_ONLINE_COMMAND_TIMEOUT' });
  }

  async start({ workDir, projectPath, timeoutMs = 180000, runToken = '' } = {}) {
    if (this.running) return this.ready;
    this.workDir = path.resolve(String(workDir || ''));
    fs.mkdirSync(this.workDir, { recursive: true });
    // 每个会话一个运行令牌：结果文件、命令文件、就绪文件、停止文件、worker 脚本名全都
    // 用它区分新旧（只给结果文件加令牌是不够的，见 buildOnlineWorkerScript 的说明）。
    this.runToken = String(runToken || '').trim() || crypto.randomBytes(6).toString('hex');
    this.resultPrefix = `online-result-${this.runToken}-`;
    for (const name of ['online-command.json', 'online-ready.json', 'online-progress.json', 'online-stop']) {
      try { fs.unlinkSync(path.join(this.workDir, name)); } catch { /* nothing to clear */ }
    }
    // Results and the other exchange files from earlier runs in this directory can
    // never belong to this run (every name carries the token), but they would pile
    // up; clear them on start. Deleting a file a lingering old worker still watches
    // is harmless — that worker simply never gets another command.
    try {
      for (const name of fs.readdirSync(this.workDir)) {
        if (!/^online-(result|command|ready|progress|stop)/.test(name)) continue;
        try { fs.unlinkSync(path.join(this.workDir, name)); } catch { /* best effort */ }
      }
    } catch { /* first start in this directory */ }
    this.commandPath = path.join(this.workDir, `online-command-${this.runToken}.json`);
    this.readyPath = path.join(this.workDir, `online-ready-${this.runToken}.json`);
    this.stopPath = path.join(this.workDir, `online-stop-${this.runToken}`);
    // 脚本文件名也带令牌，不是一个固定名字：CODESYS 在运行期间一直持有这个文件，
    // 固定名字会让"上一个进程还没退干净、下一个就启动"直接 EBUSY（现场报错正是这个）。
    const scriptPath = path.join(this.workDir, `online-worker-${this.runToken}.py`);
    // 上一轮留下的 worker 脚本：退干净了就能删，还被旧进程开着就留着（不影响本轮的
    // 新名字，这也正是给脚本名加令牌的意义）。
    try {
      for (const name of fs.readdirSync(this.workDir)) {
        if (!/^online-worker(-[0-9a-f]+)?\.py$/.test(name)) continue;
        if (name === path.basename(scriptPath)) continue;
        try { fs.unlinkSync(path.join(this.workDir, name)); } catch { /* still held by an exiting worker */ }
      }
    } catch { /* best effort */ }
    const stdoutPath = path.join(this.workDir, 'online-worker.stdout.log');
    const stderrPath = path.join(this.workDir, 'online-worker.stderr.log');
    fs.writeFileSync(scriptPath, buildOnlineWorkerScript(this.workDir, projectPath, {
      maxIdleSeconds: this.maxIdleSeconds,
      resultPrefix: this.resultPrefix,
      runToken: `-${this.runToken}`,
    }), 'utf8');
    const stdoutFd = fs.openSync(stdoutPath, 'a');
    const stderrFd = fs.openSync(stderrPath, 'a');
    const args = [`--profile="${this.profile}"`, '--noUI', `--runscript="${scriptPath}"`];
    this.seq = 0;
    this.ready = null;
    this.lastError = '';
    this.startedAt = new Date().toISOString();
    this.child = this.spawnProcess(this.exePath, args, {
      cwd: this.workDir,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
      detached: false,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    const child = this.child;
    child.on?.('exit', (code, signal) => {
      if (this.child === child) {
        this.lastError = `CODESYS 在线进程已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`;
        this.log(this.lastError);
      }
    });
    child.on?.('error', (error) => {
      this.lastError = `CODESYS 在线进程启动失败：${error?.message || error}`;
      this.log(this.lastError);
    });
    const readyPath = this.readyPath;
    const deadline = Date.now() + Math.max(10000, Number(timeoutMs) || 180000);
    const closeLogFds = () => {
      // The child inherited both descriptors; the parent's copies must go back or
      // a repeatedly failing worker leaks two handles per attempt.
      try { fs.closeSync(stdoutFd); } catch { /* already closed */ }
      try { fs.closeSync(stderrFd); } catch { /* already closed */ }
    };
    try {
      while (Date.now() < deadline) {
        if (fs.existsSync(readyPath)) {
          let payload = null;
          try { payload = JSON.parse(fs.readFileSync(readyPath, 'utf8')); } catch { payload = null; }
          if (payload) {
            if (payload.ok === true) {
              this.ready = payload;
              closeLogFds();
              return payload;
            }
            this.lastError = String(payload.error || 'CODESYS 在线进程初始化失败');
            try { child.kill(); } catch { /* already gone */ }
            throw Object.assign(new Error(this.lastError.slice(-800)), { code: 'CODESYS_ONLINE_WORKER_FAILED', details: payload });
          }
        }
        if (child.exitCode !== null) {
          throw Object.assign(new Error(this.lastError || 'CODESYS 在线进程在就绪前退出'), { code: 'CODESYS_ONLINE_WORKER_EXITED' });
        }
        await new Promise((resolve) => { setTimeout(resolve, 200); });
      }
      try { child.kill(); } catch { /* best effort */ }
      throw Object.assign(new Error('CODESYS 在线进程启动超时'), { code: 'CODESYS_ONLINE_WORKER_TIMEOUT' });
    } catch (error) {
      closeLogFds();
      throw error;
    }
  }

  async stop(reason = 'manual', { graceMs = 4000 } = {}) {
    if (!this.child) return { stopped: false, reason };
    const child = this.child;
    let graceful = false;
    try {
      if (this.running) {
        await Promise.race([
          this.send('quit', {}, graceMs),
          new Promise((resolve) => { setTimeout(resolve, graceMs); }),
        ]);
        graceful = true;
      }
    } catch {
      graceful = false;
    }
    try {
      fs.writeFileSync(this.stopPath, 'stop\n', 'utf8');
    } catch { /* best effort */ }
    const exited = await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), Math.max(500, graceMs));
      child.once?.('exit', () => { clearTimeout(timer); resolve(true); });
    });
    let killed = false;
    if (!exited) {
      try { child.kill(); killed = true; } catch { /* best effort */ }
      // 杀进程是异步的：不等它真的退出，下一个会话就会去写/打开同一个目录里的文件，
      // 而这正是 EBUSY 的来源。这里再等一小会儿，等不到也继续（所有文件名都带令牌，
      // 所以最坏情况只是那个进程多活一会儿，不会污染新会话）。
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve(true);
        const timer = setTimeout(() => resolve(false), Math.max(500, graceMs));
        child.once?.('exit', () => { clearTimeout(timer); resolve(true); });
      });
    }
    this.child = null;
    this.ready = null;
    this.log(`codesys online session stopped reason=${reason} graceful=${graceful}${killed ? ' killed=true' : ''}`);
    return { stopped: true, graceful, killed, reason };
  }

  state() {
    return {
      running: this.running,
      pid: this.child?.pid || 0,
      startedAt: this.startedAt,
      ready: this.ready,
      lastError: this.lastError,
      seq: this.seq,
      workDir: this.workDir,
      runToken: this.runToken,
      commandPath: this.commandPath,
      readyPath: this.readyPath,
    };
  }
}

module.exports = { CodesysOnlineSession, buildOnlineWorkerScript, ONLINE_COMMANDS };
