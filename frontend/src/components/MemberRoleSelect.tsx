import type { ProjectRole } from '../context/AppContext';
import { MEMBER_ROLE_MANAGER, isPmRoleName, memberRoleLabel } from '../utils/roles';

interface Props {
  /** '' — без должности, 'MANAGER' — менеджер проекта, id должности из справочника или старое значение роли */
  value: string;
  onChange: (value: string) => void;
  /** Справочник должностей (Настройки → Должности) */
  positions: ProjectRole[];
  /** Показывать ли вариант «Менеджер проекта» — назначать менеджеров может только менеджер проекта */
  allowManager: boolean;
  className?: string;
}

/**
 * Единый выбор должности участника проекта.
 * Раньше в списке смешивались «системные» роли (DEVELOPER, QA…) и «глобальные роли» из справочника —
 * теперь это один плоский список должностей плюс отдельный вариант «Менеджер проекта».
 */
export default function MemberRoleSelect({ value, onChange, positions, allowManager, className }: Props) {
  // «Project Manager» из справочника — то же самое, что «Менеджер проекта», поэтому не дублируем
  const options = positions.filter(p => !isPmRoleName(p.name));
  const known = value === '' || value === MEMBER_ROLE_MANAGER || options.some(p => String(p.id) === value);

  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">Без должности</option>
      {(allowManager || value === MEMBER_ROLE_MANAGER) && (
        <option value={MEMBER_ROLE_MANAGER}>Менеджер проекта (все права)</option>
      )}
      {options.map(p => (
        <option key={p.id} value={String(p.id)}>{p.name}</option>
      ))}
      {/* Значение из старых данных, которого нет в справочнике */}
      {!known && <option value={value}>{memberRoleLabel(value)}</option>}
    </select>
  );
}
