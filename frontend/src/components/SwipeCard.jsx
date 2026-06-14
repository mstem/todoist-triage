import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

const SWIPE_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 500;
const FLY_OUT_DISTANCE = 700;

export default function SwipeCard({ children, onSwipe, active, index = 0 }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const distance = useTransform([x, y], ([latestX, latestY]) => Math.hypot(latestX, latestY));
  // Stay fully opaque through the drag (threshold is 110px) and only fade as the
  // card flies off (FLY_OUT_DISTANCE is 700px) — otherwise it vanishes mid-drag.
  const opacity = useTransform(distance, [0, 450, 680], [1, 1, 0]);

  function settle() {
    animate(x, 0, { type: 'spring', stiffness: 450, damping: 32 });
    animate(y, 0, { type: 'spring', stiffness: 450, damping: 32 });
  }

  function flyOut(direction) {
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const target = horizontal ? x : y;
    const controls = animate(target, sign * FLY_OUT_DISTANCE, { duration: 0.28, ease: 'easeIn' });
    controls.then(() => onSwipe(direction));
  }

  function handleDragEnd(_, info) {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > Math.abs(offset.y)) {
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) return flyOut('right');
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) return flyOut('left');
    } else {
      if (offset.y < -SWIPE_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) return flyOut('up');
      if (offset.y > SWIPE_THRESHOLD || velocity.y > VELOCITY_THRESHOLD) return flyOut('down');
    }
    settle();
  }

  return (
    <motion.div
      className="swipe-card"
      style={active ? { x, y, rotate, opacity, zIndex: 100 - index } : { zIndex: 100 - index }}
      animate={{ top: index * 12, scale: 1 - index * 0.04 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      drag={active}
      dragElastic={0.7}
      dragMomentum={false}
      onDragEnd={active ? handleDragEnd : undefined}
      data-active={active}
    >
      {children}
    </motion.div>
  );
}
