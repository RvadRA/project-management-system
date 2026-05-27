import { MiniMap as ReactFlowMiniMap } from 'reactflow';
import { TASK_TYPE_CONFIG } from '../../types/workflowEditor';
import type { TaskNodeData } from '../../types/workflowEditor';

export function CustomMinimap() {
  return (
    <ReactFlowMiniMap
      nodeColor={(node) => {
        const data = node.data as TaskNodeData;
        const config = TASK_TYPE_CONFIG[data.taskType];
        return config.color;
      }}
      maskColor="rgba(0, 0, 0, 0.7)"
      style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '12px',
      }}
    />
  );
}
