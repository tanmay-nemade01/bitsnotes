export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface SectionBreakdown {
  title: string;
  pages: string;
  description: string;
}

export interface DocumentMetadata {
  title: string;
  subject: string;
  gradeLevel: string;
  datePublished: string;
  summary: string;
  targetAudience: string;
  keyConcepts: string[];
  sections: SectionBreakdown[];
  quiz: QuizQuestion[];
  pageTranscripts?: string[];
}

const drlLecturesMetadata: Record<string, Omit<DocumentMetadata, 'title'>> = {
  "drl - lecture 1": {
    subject: "Computer Science / Artificial Intelligence",
    gradeLevel: "Advanced Undergraduate / Graduate",
    datePublished: "May 25, 2026",
    targetAudience: "Students studying Machine Learning, Robotics, and Decision Theory who want to understand the mathematical foundations of Reinforcement Learning.",
    summary: "This lecture notes set introduces the fundamental paradigm of Reinforcement Learning (RL) and details the framework of Markov Decision Processes (MDPs). Unlike supervised learning, RL agents learn through trial-and-error interactions with an environment to maximize a cumulative scalar reward signal. The lecture formalizes the agent-environment interface, defines state and action spaces, and outlines the Markov property—which asserts that the future state depends only on the current state and action, not on historical trajectories. It also explores key concepts such as rewards, returns, and the role of the discount factor (gamma) in continuing versus episodic tasks, laying the essential mathematical groundwork for understanding value functions and optimal policies.",
    keyConcepts: [
      "Explain the fundamental difference between Supervised, Unsupervised, and Reinforcement Learning.",
      "Understand and define the components of a Markov Decision Process (MDP): States, Actions, Transitions, and Rewards.",
      "Understand the Markov Property and its mathematical formulation in state transition probabilities.",
      "Calculate the expected discounted return using the discount factor for episodic and continuing environments.",
      "Identify the components of the agent-environment loop and trace how information flows during action execution."
    ],
    sections: [
      {
        title: "Section 1: The Reinforcement Learning Paradigm",
        pages: "Pages 1-2",
        description: "Overview of RL characteristics: trial-and-error, delayed rewards, and the active feedback loop between the agent and environment."
      },
      {
        title: "Section 2: Markov Decision Processes (MDPs)",
        pages: "Pages 3-4",
        description: "Formal mathematical definition of MDPs, state transitions, action spaces, and the formulation of the transition probability matrix."
      },
      {
        title: "Section 3: The Markov Property",
        pages: "Page 5",
        description: "Conceptual breakdown of history-independence and why the current state is a sufficient statistic for planning the future."
      },
      {
        title: "Section 4: Rewards and Returns",
        pages: "Pages 6-7",
        description: "Defining reward functions, the calculation of episodic returns, and the role of the discount factor (gamma) in ensuring convergence in infinite-horizon tasks."
      }
    ],
    quiz: [
      {
        question: "What is the defining characteristic of the Markov Property in an MDP?",
        options: [
          "The next state depends on the entire history of actions and states visited.",
          "The next state depends only on the current state and action.",
          "The agent receives a reward only at the end of the episode.",
          "The transition probability is always deterministic."
        ],
        answerIndex: 1,
        explanation: "The Markov property states that the future is independent of the past given the present. Mathematically, P(S_{t+1} | S_t, A_t, ..., S_0, A_0) = P(S_{t+1} | S_t, A_t)."
      },
      {
        question: "Why is a discount factor (gamma) typically used in Reinforcement Learning?",
        options: [
          "To speed up the training of neural networks.",
          "To penalize the agent for taking actions that lead to failures.",
          "To bound the sum of rewards in infinite-horizon tasks and prioritize immediate rewards over distant future rewards.",
          "To normalize the inputs to the state-value function."
        ],
        answerIndex: 2,
        explanation: "A discount factor gamma < 1 ensures that the infinite sum of rewards converges to a finite value and models the preference for immediate rewards (due to uncertainty in the future)."
      },
      {
        question: "In the agent-environment loop, what two inputs does the agent receive from the environment at each time step?",
        options: [
          "A new state and a reward",
          "An action and a reward",
          "A policy and a value function",
          "A state and an action"
        ],
        answerIndex: 0,
        explanation: "At each step, the environment transition outputs the next state S_{t+1} and the corresponding scalar reward R_{t+1} back to the agent."
      }
    ]
  },
  "drl - lecture 2": {
    subject: "Computer Science / Artificial Intelligence",
    gradeLevel: "Advanced Undergraduate / Graduate",
    datePublished: "May 26, 2026",
    targetAudience: "Students seeking a solid grasp of dynamic programming, Bellman equations, and systematic policy planning in MDPs.",
    summary: "This study guide covers Dynamic Programming (DP) algorithms applied to planning in Markov Decision Processes. Dynamic Programming requires complete knowledge of the environment's transition dynamics (model-based learning). The lecture develops the state-value function (V) and action-value function (Q) and derives the famous Bellman Expectation and Optimality Equations. These recursive equations break down value functions into an immediate reward plus the discounted value of successor states. Using these foundations, the lecture explains how to solve MDPs using Iterative Policy Evaluation to compute V for a fixed policy, followed by Policy Improvement. Combining these two phases leads to the Policy Iteration algorithm. Finally, the lecture introduces Value Iteration, which solves for the optimal policy directly by updating state values based on the maximum possible actions.",
    keyConcepts: [
      "Formulate and write the Bellman Expectation Equations for V(s) and Q(s,a).",
      "Understand the concept of planning in RL and why Dynamic Programming assumes a known model of the environment.",
      "Apply the Policy Improvement Theorem to construct a better policy from calculated value functions.",
      "Detail the mechanics of Policy Iteration: alternating policy evaluation and greedy policy improvement.",
      "Describe Value Iteration and explain how it differs from Policy Iteration in terms of computational steps."
    ],
    sections: [
      {
        title: "Section 1: Value Functions and Bellman Equations",
        pages: "Pages 1-3",
        description: "Defining state-value V(s) and action-value Q(s,a) functions and deriving the recursive Bellman expectation equations."
      },
      {
        title: "Section 2: Policy Evaluation (Prediction)",
        pages: "Pages 4-5",
        description: "Solving for V(s) under a fixed policy using iterative updates and exploring proof of convergence."
      },
      {
        title: "Section 3: Policy Iteration",
        pages: "Pages 6-7",
        description: "Detailing the policy improvement step and detailing the complete Policy Iteration loop to find the optimal policy."
      },
      {
        title: "Section 4: Value Iteration",
        pages: "Page 8",
        description: "Direct planning using the Bellman Optimality Equation, updating values by taking max actions, and analyzing efficiency."
      }
    ],
    quiz: [
      {
        question: "What is the key assumption of Dynamic Programming (DP) methods in Reinforcement Learning?",
        options: [
          "The environment's dynamics (transition probabilities and rewards) are completely known.",
          "The state space is always continuous.",
          "The agent does not require any feedback from the environment.",
          "The policy must be parameterized as a neural network."
        ],
        answerIndex: 0,
        explanation: "Dynamic programming is a model-based planning method. It assumes that the transition probabilities P(s'|s,a) and reward functions R(s,a) are completely known to the agent beforehand."
      },
      {
        question: "How does Value Iteration differ from Policy Iteration?",
        options: [
          "Value Iteration evaluates the policy to convergence before improving it.",
          "Value Iteration does not use Bellman equations.",
          "Value Iteration combines evaluation and improvement steps by directly updating values using a 'max' operator without waiting for policy evaluation to converge.",
          "Value Iteration can only be used in model-free settings."
        ],
        answerIndex: 2,
        explanation: "Policy iteration alternates between full policy evaluation (solving for V^pi) and policy improvement. Value iteration integrates them by applying the Bellman optimality backup directly, which implicitly updates the policy with a 'max' over actions at each step."
      },
      {
        question: "If a policy is improved greedily with respect to the state-value function V(s), the new policy is guaranteed to be:",
        options: [
          "Equally good or better than the original policy.",
          "Worse than the original policy.",
          "Completely random.",
          "Stochastic even if the original was deterministic."
        ],
        answerIndex: 0,
        explanation: "The Policy Improvement Theorem guarantees that a policy greedily chosen with respect to the value function of a policy pi will be at least as good as pi, i.e., V^{pi'}(s) >= V^{pi}(s) for all states s."
      }
    ]
  },
  "drl - lecture 3": {
    subject: "Computer Science / Artificial Intelligence",
    gradeLevel: "Advanced Undergraduate / Graduate",
    datePublished: "May 27, 2026",
    targetAudience: "Students wanting to learn model-free learning techniques, including Monte Carlo simulation and Temporal Difference learning.",
    summary: "This study guide delves into model-free Reinforcement Learning, where the agent does not know the transition probabilities and rewards of the environment and must learn directly from raw experience. The lecture covers two primary families of model-free prediction: Monte Carlo (MC) methods and Temporal Difference (TD) learning. MC methods learn from complete episodes, updating values based on the actual terminal return, which results in zero bias but high variance. In contrast, TD learning updates values at every time step using bootstrapping (updating a guess based on another guess), which has low variance but introduces bias. The lecture compares MC and TD(0) backup diagrams and covers control algorithms: SARSA (an on-policy control algorithm that learns the value of the policy being executed) and Q-learning (an off-policy control algorithm that learns the optimal value function independently of the agent's behavior policy).",
    keyConcepts: [
      "Distinguish between model-based planning (Dynamic Programming) and model-free learning.",
      "Understand the mechanics of Monte Carlo (MC) prediction and the necessity of completing episodes.",
      "Explain Temporal Difference (TD) learning and the concept of bootstrapping.",
      "Compare the bias-variance trade-offs between Monte Carlo and TD methods.",
      "Derive and explain the update rules for SARSA (on-policy) and Q-learning (off-policy)."
    ],
    sections: [
      {
        title: "Section 1: Model-Free Prediction",
        pages: "Pages 1-2",
        description: "Introduction to learning from experience and the formulation of empirical averages."
      },
      {
        title: "Section 2: Monte Carlo Methods",
        pages: "Pages 3-4",
        description: "First-visit and every-visit MC methods, return calculations, and why they require episodic environments."
      },
      {
        title: "Section 3: Temporal Difference Learning",
        pages: "Pages 5-6",
        description: "The TD(0) algorithm, the TD error, and bootstrapping. Analysis of backups and bias-variance properties."
      },
      {
        title: "Section 4: Model-Free Control (SARSA vs Q-Learning)",
        pages: "Pages 7-8",
        description: "Exploration vs exploitation (epsilon-greedy), SARSA on-policy update loop, and Q-learning off-policy update using optimal future actions."
      }
    ],
    quiz: [
      {
        question: "Which of the following is a primary difference between Monte Carlo (MC) and Temporal Difference (TD) learning?",
        options: [
          "MC requires a model of the environment, whereas TD does not.",
          "MC updates values after a single step, while TD waits for the end of the episode.",
          "MC updates values based on actual final returns at the end of an episode, while TD updates values immediately by bootstrapping from successor state estimates.",
          "MC has higher bias than TD."
        ],
        answerIndex: 2,
        explanation: "MC methods must wait until the end of an episode to compute the return G_t before making an update. TD methods update immediately after one step (TD(0)) by using the reward plus the estimated value of the next state: R_{t+1} + gamma * V(S_{t+1})."
      },
      {
        question: "What makes Q-learning an 'off-policy' algorithm?",
        options: [
          "It does not use a policy to select actions during exploration.",
          "It learns the value of the optimal policy while the agent behaves according to an exploratory policy (like epsilon-greedy).",
          "It is only executed when the agent is turned off.",
          "It updates the value function using the action that was actually taken by the agent."
        ],
        answerIndex: 1,
        explanation: "Q-learning is off-policy because its update target uses the maximum Q-value over all possible actions in the next state, Q(S_{t+1}, a), representing the optimal target policy, regardless of which action the agent actually took under its behavior policy."
      },
      {
        question: "What does 'bootstrapping' mean in the context of TD learning?",
        options: [
          "The algorithm uses a random number generator to start.",
          "Updating value estimates based on other estimated values of successor states, rather than actual outcomes.",
          "Running multiple simulation paths in parallel.",
          "Pre-training the agent with human demonstration data."
        ],
        answerIndex: 1,
        explanation: "Bootstrapping refers to updating an estimate with another estimate. In TD learning, V(S_t) is updated toward a target that includes the current estimate of V(S_{t+1})."
      }
    ]
  },
  "drl - lecture 4": {
    subject: "Computer Science / Artificial Intelligence",
    gradeLevel: "Advanced Undergraduate / Graduate",
    datePublished: "May 28, 2026",
    targetAudience: "Students interested in scaling reinforcement learning to massive or continuous state spaces using neural networks (Deep Q-Networks).",
    summary: "This lecture notes set covers Value Function Approximation, which allows Reinforcement Learning algorithms to scale to high-dimensional or continuous state spaces (such as pixels in video games or joint angles in robotics) where tabular methods fail. The lecture starts by generalizing value representation using parameter vectors, moving from linear approximation to deep neural networks. The core of the lecture focuses on Deep Q-Networks (DQN), the algorithm that successfully learned to play Atari games from raw pixels. It explains the DQN loss function and the severe training instabilities caused by non-stationary targets and highly correlated data sequences. To solve these issues, the lecture details two key stabilization mechanisms: the Experience Replay Buffer (which breaks data correlation through random batch sampling) and the Target Network (which stabilizes training targets by updating target weights slowly).",
    keyConcepts: [
      "Explain why tabular Q-learning fails in continuous or high-dimensional state spaces.",
      "Formulate the mean squared value error objective for value function approximation.",
      "Describe the Deep Q-Network (DQN) loss function and its parameters.",
      "Analyze the causes of training instability in deep RL and how DQN addresses them.",
      "Explain the mechanics and benefits of the Experience Replay Buffer and Target Networks."
    ],
    sections: [
      {
        title: "Section 1: Need for Function Approximation",
        pages: "Pages 1-2",
        description: "The curse of dimensionality in tabular RL, and using parameterized function approximators to represent values."
      },
      {
        title: "Section 2: Deep Q-Networks (DQN)",
        pages: "Pages 3-4",
        description: "Integrating deep neural networks with Q-learning, the network architecture, and processing raw pixel inputs."
      },
      {
        title: "Section 3: Instability in Deep RL",
        pages: "Page 5",
        description: "Exploring why simple combination of TD learning and neural networks diverges (non-stationary targets, correlated samples, policy loops)."
      },
      {
        title: "Section 4: Stabilization Techniques",
        pages: "Pages 6-8",
        description: "Deep dive into the Experience Replay Buffer (random sampling, off-policy transition storage) and the separate target network parameterization (theta-minus)."
      }
    ],
    quiz: [
      {
        question: "Why does training a neural network with standard temporal difference updates diverge without an experience replay buffer?",
        options: [
          "Sequential transitions in an episode are highly correlated, violating the independent and identically distributed (i.i.d.) assumption of gradient descent.",
          "The neural network does not have enough parameters.",
          "The reward signals are too large to process.",
          "The policy becomes deterministic too quickly."
        ],
        answerIndex: 0,
        explanation: "In RL, consecutive states are highly correlated. Feeding these sequential samples directly to a neural network violates the i.i.d. assumption, causing the network's weights to overfit to local trajectories. Replay buffers break these correlations by sampling mini-batches randomly from past transitions."
      },
      {
        question: "What is the role of the Target Network in DQN?",
        options: [
          "To select the best action for the agent to take in the environment.",
          "To provide a stable target Q-value (with frozen parameters) during the loss calculation, preventing the target from moving simultaneously with the network updates.",
          "To calculate the policy gradient directly.",
          "To store the agent's historical transitions."
        ],
        answerIndex: 1,
        explanation: "Without a target network, the network updates its weights theta to match a target that also depends on theta. This is like a dog chasing its own tail. A separate target network with parameters theta^- is updated slowly, keeping the regression targets stationary for a period of time."
      },
      {
        question: "What is the standard loss function minimized in DQN training?",
        options: [
          "Cross-Entropy Loss between actions",
          "Mean Squared Bellman Error (MSBE) comparing predicted Q(s,a; theta) with the target R + gamma * max_a' Q(s', a'; theta^-)",
          "Policy gradient loss with baseline",
          "Kullback-Leibler divergence of policy distribution"
        ],
        answerIndex: 1,
        explanation: "DQN is trained by minimizing the Mean Squared Bellman Error, treating the temporal difference target R + gamma * max_a Q(s', a; theta^-) as a fixed target for regression."
      }
    ]
  },
  "drl - lecture 5": {
    subject: "Computer Science / Artificial Intelligence",
    gradeLevel: "Advanced Undergraduate / Graduate",
    datePublished: "May 29, 2026",
    targetAudience: "Students studying advanced policy-based optimization, actor-critic frameworks, and continuous control algorithms.",
    summary: "This study guide covers Policy Gradient methods, shifting the focus from learning value functions (value-based RL) to directly learning and optimizing the policy parameters (policy-based RL). The lecture details the advantages of policy parameterization, including the capability to learn stochastic policies and operate in continuous action spaces. It derives the Policy Gradient Theorem, which allows computing the gradient of performance with respect to policy parameters without knowing the environment's transition dynamics. We study the classic REINFORCE algorithm (Monte Carlo policy gradient) and show how subtracting a state-dependent baseline significantly reduces gradient variance without introducing bias. Finally, the lecture introduces Actor-Critic architectures, where the 'Actor' updates the policy parameters in the direction of positive advantages and the 'Critic' fits a value function to evaluate state quality and compute the baseline.",
    keyConcepts: [
      "Understand the benefits of policy-based RL over value-based methods (stochastic policies, continuous actions).",
      "Formulate and explain the Policy Gradient Theorem.",
      "Explain the REINFORCE algorithm and trace its Monte Carlo update steps.",
      "Analyze the role of a baseline in reducing variance and prove it does not introduce bias.",
      "Describe the Actor-Critic framework and detail how the actor and critic interact."
    ],
    sections: [
      {
        title: "Section 1: Policy Search & Parameterization",
        pages: "Pages 1-2",
        description: "Introduction to direct policy optimization, representing stochastic policies, and the benefits of continuous control."
      },
      {
        title: "Section 2: The Policy Gradient Theorem",
        pages: "Pages 3-4",
        description: "Mathematical derivation of the gradient of expected return, proving why we do not need derivatives of state transition dynamics."
      },
      {
        title: "Section 3: REINFORCE and Baselines",
        pages: "Pages 5-6",
        description: "The REINFORCE algorithm steps, calculating log-probabilities, and adding a baseline (value function V(s)) to reduce Monte Carlo variance."
      },
      {
        title: "Section 4: Actor-Critic Architectures",
        pages: "Pages 7-8",
        description: "Blending value-based and policy-based methods. The Critic estimates value V(s) to compute the advantage, while the Actor updates the policy using policy gradients."
      }
    ],
    quiz: [
      {
        question: "Why are policy-based methods preferred over value-based methods (like DQN) in continuous action spaces?",
        options: [
          "Value-based methods cannot handle large discount factors.",
          "In continuous spaces, finding the maximum action in the Q-value function max_a Q(s,a) requires solving a costly optimization problem at every step, whereas policy networks output actions directly.",
          "Policy-based methods do not require neural networks.",
          "Policy gradients always converge to the global optimum much faster."
        ],
        answerIndex: 1,
        explanation: "For value-based methods, action selection requires a max_a Q(s,a) operation. If the action space is continuous, this requires running an optimization algorithm (like gradient ascent) at every decision step, which is computationally expensive. Policy networks bypass this by directly outputting action values or distribution parameters."
      },
      {
        question: "What is the primary function of the baseline in the REINFORCE update formula: gradient_theta = E[ grad log pi(a|s) * (G_t - b(s)) ]?",
        options: [
          "To introduce bias that speeds up learning.",
          "To normalize the actions taken by the agent.",
          "To reduce the variance of the gradient estimates without changing the expected value of the gradient.",
          "To limit the action space boundary."
        ],
        answerIndex: 2,
        explanation: "Subtracting a state-dependent baseline b(s) (typically the value function estimate V(s)) reduces the variance of the returns G_t significantly. This stabilizes gradient updates without introducing any mathematical bias to the expected policy gradient."
      },
      {
        question: "In an Actor-Critic architecture, what are the distinct roles of the Actor and the Critic?",
        options: [
          "The Actor controls the environment, while the Critic controls the reward function.",
          "The Actor parameterizes the policy (selects actions), while the Critic parameterizes the value function (evaluates the state quality and guides the actor's updates).",
          "The Actor updates values, while the Critic calculates gradient steps.",
          "The Actor handles exploration, while the Critic handles exploitation."
        ],
        answerIndex: 1,
        explanation: "The Actor represents the policy pi(a|s; theta) and chooses actions. The Critic represents the value function V(s; w) (or Q(s,a)) and evaluates states, providing a temporal difference error or advantage estimate to update the Actor's policy parameters."
      }
    ]
  }
};

export function getFallbackMetadata(lectureName: string, subjectName?: string): DocumentMetadata {
  const normalizedId = lectureName.toLowerCase().trim();
  
  // Try to match DRL lectures first
  if (drlLecturesMetadata[normalizedId]) {
    return {
      title: lectureName,
      ...drlLecturesMetadata[normalizedId]
    };
  }

  // Parse structured document ID: "Subject - DocumentName"
  let subject = subjectName || "General Course Notes";
  let displayTitle = lectureName;
  
  const parts = lectureName.split(" - ");
  if (parts.length >= 2) {
    subject = parts[0].trim();
    displayTitle = parts.slice(1).join(" - ").trim();
  }

  // Capitalize displayTitle nicely if it matches "lectureX" or "lecture_X" or "lecture-X"
  let readableTitle = displayTitle;
  if (/^lecture[\s_-]*\d+$/i.test(displayTitle)) {
    const num = displayTitle.match(/\d+/)?.[0];
    readableTitle = `Lecture ${num}`;
  } else {
    // Basic capitalization of first letter
    readableTitle = displayTitle.charAt(0).toUpperCase() + displayTitle.slice(1);
  }

  const formattedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return {
    title: readableTitle,
    subject: subject,
    gradeLevel: "High School / Undergraduate",
    datePublished: formattedDate,
    targetAudience: `Students studying ${readableTitle} under the ${subject} curriculum who are looking for clear explanations, conceptual breakdowns, and interactive review questions to master the course material.`,
    summary: `This comprehensive study guide covers the essential concepts, equations, and methodologies presented in the ${subject} document '${readableTitle}'. It outlines key terms, explains standard problem-solving strategies, and presents structured notes to aid in retention. The guide is designed to highlight the core themes of ${subject}, bridge theoretical formulas with practical examples, and provide a self-assessment path for students preparing for assignments and examinations in this subject area.`,
    keyConcepts: [
      `Understand the key definitions, terminology, and course context of ${subject}.`,
      `Analyze the core mechanisms, models, and equations introduced in the ${readableTitle} notes.`,
      `Apply the concepts of ${subject} to solve standard exercises and review step-by-step solutions.`,
      "Synthesize theoretical ideas to build a comprehensive framework of the lecture material."
    ],
    sections: [
      {
        title: "Section 1: Foundations and Background",
        pages: "Pages 1-2",
        description: `Overview of basic ${subject} concepts, introduction to key terminology, and setting the academic context.`
      },
      {
        title: "Section 2: Core Analysis and Methodology",
        pages: "Pages 3-5",
        description: `Detailed walk-through of the main methodologies, mathematical equations, or theories proposed in ${readableTitle}.`
      },
      {
        title: "Section 3: Practical Applications and Exercises",
        pages: "Pages 6-8",
        description: "Examples of applying the theory to practical problems, accompanied by step-by-step guidance."
      }
    ],
    quiz: [
      {
        question: `What is the primary academic focus of the ${subject} document '${readableTitle}'?`,
        options: [
          "To provide a structured review of core concepts and their applications.",
          "To present unrelated historical anecdotes.",
          "To serve as a generic blank template.",
          "To discuss advanced research topics outside the standard curriculum."
        ],
        answerIndex: 0,
        explanation: `The primary objective of '${readableTitle}' is to break down the core curriculum concepts of ${subject} and illustrate their practical applications.`
      },
      {
        question: "How are the sections in this study guide organized to aid learning?",
        options: [
          "They are sorted randomly.",
          "They progress from basic foundations, through detailed methodology, to practical exercises and applications.",
          "They only present questions without answers.",
          "They cover advanced theoretical topics without basic context."
        ],
        answerIndex: 1,
        explanation: "The guide is logically structured to build understanding progressively, starting with foundational definitions before moving to complex theories and practice problems."
      },
      {
        question: `Which of the following describes the correct approach to using these ${subject} notes?`,
        options: [
          "Memorizing text word-for-word without understanding details.",
          "Skipping summaries and only viewing the final page.",
          "Reading the crawlable overview, checking key concepts, reviewing the sections, and taking the practice quiz to verify understanding.",
          "Attempting to download the flat images to print them out."
        ],
        answerIndex: 2,
        explanation: "The best learning outcome is achieved by reading the summary context, focusing on the core learning objectives, and using the practice quiz at the bottom for active recall."
      }
    ],
    pageTranscripts: []
  };
}
