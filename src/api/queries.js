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
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
  }
  baseRef {
    name
    branchProtectionRule {
      requiredStatusCheckContexts
    }
  }
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 100) {
    nodes {
      author {
        login
      }
      state
    }
  }
  reviewThreads(first: 100) {
    nodes {
      isResolved
    }
  }
  statusCheckRollup {
    state
    contexts(first: 100) {
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
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
  }
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 100) {
    nodes {
      author {
        login
      }
      state
    }
  }
}
`;

// Nested connections use GitHub's maximum page size so that classification
// never misses a required check, review thread or reviewer. The top-level
// lists are capped at MAX_PRS_PER_LIST; pageInfo reports whether more exist.
export const MAX_PRS_PER_LIST = 30;

export const FETCH_ALL_PRS_QUERY = `
${AUTHORED_PR_FRAGMENT}
${SEARCH_PR_FRAGMENT}

query PullRequestsData {
  viewer {
    login
    pullRequests(first: ${MAX_PRS_PER_LIST}, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo {
        hasNextPage
      }
      nodes {
        ...AuthoredPRDetails
      }
    }
  }
  reviewRequested: search(query: "type:pr state:open review-requested:@me", type: ISSUE, first: ${MAX_PRS_PER_LIST}) {
    pageInfo {
      hasNextPage
    }
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
  }
}
`;
