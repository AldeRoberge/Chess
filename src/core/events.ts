export interface ExperienceEvent {
  type: string; // move | capture | check | mate | castle | promotion | lifted | illegal | seat | leave | mode | phase | ...
  t: number;
  data?: Record<string, any>;
}
