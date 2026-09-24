const fs = require('fs');
const path = require('path');

class ExpertConfigStore {
  constructor(root) {
    this.file = path.join(root, 'experts', 'experts.json');
  }

  read() {
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!value || !Array.isArray(value.teams) || !Array.isArray(value.experts)) throw new Error('专家配置格式无效');
    return value;
  }

  write(value) {
    fs.writeFileSync(this.file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  status() {
    const value = this.read();
    const selectedTeam = value.teams.find((item) => item.id === value.selectedTeamId) || null;
    const activeExpert = value.experts.find((item) => item.id === value.activeExpertId) || null;
    return {
      enabled: value.teamEnabled === true,
      selectedTeamId: selectedTeam?.id || '',
      selectedTeamName: selectedTeam?.name || '',
      activeExpertId: activeExpert?.id || '',
      activeExpertName: activeExpert?.name || '',
      teams: value.teams.map((item) => ({
        id: item.id,
        name: item.name,
        expertIds: Array.isArray(item.expertIds) ? item.expertIds : (item.members || []).map((member) => member.expertId).filter(Boolean),
        workflowStages: Array.isArray(item.workflow?.stages) ? item.workflow.stages.map((stage) => ({ id: String(stage.id || ''), owner: String(stage.owner || ''), dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn.map(String) : [], trigger: String(stage.trigger || ''), writeMode: String(stage.writeMode || '') })) : [],
      })),
      experts: value.experts.map((item) => ({
        id: item.id,
        name: item.name,
        role: item.role || '',
        providerId: item.providerId || '',
        model: item.model || '',
        knowledgeLibraryIds: Array.isArray(item.knowledgeLibraryIds) ? item.knowledgeLibraryIds : [],
        permissions: item.permissions || 'read-only',
        reasoningEffort: item.reasoningEffort || '',
        harnessRole: item.harnessRole || 'worker',
        teamRole: item.teamRole || 'member',
      })),
    };
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('专家启用状态必须是布尔值');
    const value = this.read();
    value.teamEnabled = enabled;
    this.write(value);
    return this.status();
  }

  setSelection(input = {}) {
    const value = this.read();
    const teamId = input.teamId === undefined ? String(value.selectedTeamId || '') : String(input.teamId || '');
    const expertId = input.expertId === undefined ? String(value.activeExpertId || '') : String(input.expertId || '');
    const team = value.teams.find((item) => item.id === teamId);
    if (teamId && !team) throw new Error('所选专家团队不存在');
    if (expertId && !value.experts.some((item) => item.id === expertId)) throw new Error('所选专家不存在');
    const teamExpertIds = new Set(Array.isArray(team?.expertIds) ? team.expertIds : (team?.members || []).map((member) => member.expertId));
    if (team && expertId && !teamExpertIds.has(expertId)) throw new Error('所选专家不属于当前专家团队');
    value.selectedTeamId = teamId;
    value.activeExpertId = expertId;
    value.activeExpertIds = expertId ? [expertId] : [];
    this.write(value);
    return this.status();
  }

  createExpert(input = {}) {
    const value = this.read();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('专家名称不能为空');
    const id = `expert-${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'custom'}`;
    const expert = {
      id, name, role: String(input.role || '自定义专家'), systemPrompt: String(input.systemPrompt || ''),
      providerId: String(input.providerId || ''), model: String(input.model || ''), reasoningEffort: String(input.reasoningEffort || ''),
      skills: Array.isArray(input.skills) ? input.skills.map(String).slice(0, 30) : [], tools: Array.isArray(input.tools) ? input.tools.map(String).slice(0, 30) : [],
      knowledgeLibraryIds: Array.isArray(input.knowledgeLibraryIds) ? input.knowledgeLibraryIds.map(String).slice(0, 30) : [],
      permissions: String(input.permissions || 'read-only'), memoryProvider: String(input.memoryProvider || 'local'),
      outputFormat: String(input.outputFormat || '结论、证据、验证步骤、风险'), harnessRole: String(input.harnessRole || 'worker'), teamRole: String(input.teamRole || 'member'),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    value.experts.push(expert);
    this.write(value);
    return this.status();
  }

  updateExpert(input = {}) {
    const value = this.read();
    const expert = value.experts.find((item) => item.id === String(input.id || ''));
    if (!expert) throw new Error('所选专家不存在');
    for (const key of ['name', 'role', 'systemPrompt', 'providerId', 'model', 'reasoningEffort', 'permissions', 'memoryProvider', 'outputFormat', 'harnessRole', 'teamRole']) if (input[key] !== undefined) expert[key] = String(input[key]);
    for (const key of ['skills', 'tools', 'knowledgeLibraryIds']) if (input[key] !== undefined) expert[key] = Array.isArray(input[key]) ? input[key].map(String).slice(0, 30) : [];
    expert.updatedAt = new Date().toISOString();
    this.write(value);
    return this.status();
  }

  removeExpert(id) {
    const value = this.read();
    const target = String(id || '');
    if (!value.experts.some((item) => item.id === target)) throw new Error('所选专家不存在');
    value.experts = value.experts.filter((item) => item.id !== target);
    for (const team of value.teams) {
      team.expertIds = (team.expertIds || []).filter((item) => item !== target);
      team.members = (team.members || []).filter((item) => item.expertId !== target);
    }
    if (value.activeExpertId === target) value.activeExpertId = '';
    value.activeExpertIds = (value.activeExpertIds || []).filter((item) => item !== target);
    this.write(value);
    return this.status();
  }
}

module.exports = { ExpertConfigStore };
