import AIButton from './AIButton.jsx';
import { aiTask } from '../api.js';

export default function TaskCard({ task }) {
  const location = [task.parentProjectName, task.projectName].filter(Boolean).join(' / ');

  return (
    <>
      {location && <p className="swipe-card__eyebrow">In: {location}</p>}
      <h2 className="swipe-card__title">{task.content}</h2>
      <div className="swipe-card__body">
        {task.description && <p className="swipe-card__description">{task.description}</p>}
      </div>
      <div className="swipe-card__footer">
        {task.due?.string && <span className="swipe-card__due">Due {task.due.string}</span>}
        <AIButton
          name={task.content}
          onTrigger={() =>
            aiTask({
              todoistId: task.id,
              content: task.content,
              description: task.description,
              projectName: task.projectName,
              parentProjectName: task.parentProjectName,
            })
          }
        />
      </div>
    </>
  );
}
