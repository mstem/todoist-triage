import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import ProjectReview from './pages/ProjectReview.jsx';
import TaskReview from './pages/TaskReview.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<ProjectReview />} />
        <Route path="/tasks" element={<TaskReview />} />
      </Routes>
    </BrowserRouter>
  );
}
