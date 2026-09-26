// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const AUTHORED_PR_FRAGMENT = `
fragment AuthoredPRDetails on PullRequest {
  id
  number
  title
  url
  isDraft
  mergeable
  mergeStateStatus
  reviewDecision
  updatedAt
  createdAt
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
    avatarUrl
  }
  baseRef {
    name
    branchProtectionRule {
      requiredStatusCheckContexts
    }
  }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 10) {
    nodes {
      author {
        login
      }
      state
      createdAt
    }
  }
  reviewThreads(first: 20) {
    nodes {
      isResolved
    }
  }
  statusCheckRollup {
    state
    contexts(first: 20) {
      nodes {
        __typename
        ... on CheckRun {
          name
          conclusion
          status
        }
        ... on StatusContext {
          context
          state
        }
      }
    }
  }
}
`;

export const SEARCH_PR_FRAGMENT = `
fragment SearchPRDetails on PullRequest {
  id
  number
  title
  url
  isDraft
  mergeable
  updatedAt
  createdAt
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
    avatarUrl
  }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 10) {
    nodes {
      author {
        login
      }
      state
      createdAt
    }
  }
}
`;

export const FETCH_ALL_PRS_QUERY = `
${AUTHORED_PR_FRAGMENT}
${SEARCH_PR_FRAGMENT}

query PullRequestsData {
  viewer {
    login
    avatarUrl
    pullRequests(first: 30, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        ...AuthoredPRDetails
      }
    }
  }
  reviewRequested: search(query: "type:pr state:open review-requested:@me", type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        ...SearchPRDetails
      }
    }
  }
}
`;

export const VERIFY_USER_QUERY = `
query VerifyUser {
  viewer {
    login
    name
    avatarUrl
  }
}
`;
