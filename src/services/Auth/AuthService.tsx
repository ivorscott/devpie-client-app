import React, { useState, useEffect } from "react";
import { actions } from "./reducers";
import { AWSConnect, getAuthDetails, transformUser } from "./helpers";
import { Auth0Client } from "@auth0/auth0-spa-js";
import { useDispatch } from "react-redux";
import { history } from "../../history";
import { client } from "../Client";
import { env } from "../../env";
import { Loading } from "../../shared/components/Loading";
import { fetchImage } from "../../features/Account/reducer";
import { UserPayload } from "./types";

export function fbLoginWithRedirect() {
  window.location.assign(`${env.freshbooks_authorization_url}?client_id=${env.freshbooks_client_id}&response_type=code&redirect_uri=${env.redirect_uri}`)
}

// verify freshbooks token by attempting to access users me endpoint
export async function isFbTokenVerifed(): Promise<boolean> {
  return new Promise( async (res)=> {
    try {
      const token = localStorage.getItem('fbtk')
      const response = await fetch(`${env.freshbooks_api_url}/users/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.status === 200) {
        return res(true)
      } 
    } catch(e) {
      console.log(e)
      return res(false)
    }
  })
}

async function fbHandleRedirect() {
  const authorization_code = window.location.search.substr(6)
  const data = {
    grant_type: "authorization_code",
    client_id: env.freshbooks_client_id,
    code: authorization_code,
    client_secret: env.freshbooks_client_secret,
    redirect_uri: env.redirect_uri
  }

  const response = await fetch(`${env.freshbooks_token_url}`, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json'
    }, 
    body: JSON.stringify(data)
  })

  const json = await response.json()
  localStorage.setItem('fbtk', json.access_token)
}

const {
  domain,
  audience,
  client_id,
  redirect_uri,
  identity_pool_id,
  s3_bucket,
  s3_bucket_region,
  cognito_region,
} = env;

const { authenticateUser } = actions;

export const auth0Client = new Auth0Client({
  domain: domain as string,
  audience: audience as string,
  client_id: client_id as string,
  redirect_uri: redirect_uri as string,
  useRefreshTokens: true,
});

const Auth0Provider: React.FC<{ children: any }> = ({ children }) => {
  const [isError, setIsError] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    const authenticate = async () => {
      try {
        const { search, pathname } = window.location;

        // handle freshbooks redirect
        if (search.includes("code=") && !search.includes("state=")) {
          console.log("test")
          await fbHandleRedirect()
        }

        // handle auth0 redirect
        if (search.includes("code=") && search.includes("state=")) {
          const { appState } = await auth0Client.handleRedirectCallback();
          history.push(appState ? appState : pathname);
        }

        const ok = await auth0Client.isAuthenticated();

        if (ok) {
          setIsAuthenticated(ok);

          const authResult = await getAuthDetails(auth0Client);
          const { auth0_user, access_token, claims } = authResult;

          const roles = claims["https://client.devpie.io/claims/roles"];
          const user = (await client.get("/users/me")) as UserPayload;

          await AWSConnect({
            auth0_user,
            auth0_id_token: claims.__raw,
            auth0_id_token_exp: claims.exp as number,
            auth0_domain: domain as string,
            auth0_access_token: access_token,
            cognito_region: cognito_region as string,
            cognito_identity_pool_id: identity_pool_id as string,
            s3_bucket: s3_bucket as string,
            s3_bucket_region: s3_bucket_region as string,
          });

          if (!user.error) {
            dispatch(authenticateUser({ ...user, roles }));
            dispatch(fetchImage(auth0_user.sub));
          } else {
            const newUser = transformUser(auth0_user);
            dispatch(authenticateUser({ ...newUser, roles }));
            await client.post("/users", newUser);
          }

        } else {
          await auth0Client.loginWithRedirect({
            appState: pathname,
          });
        }
      } catch (err) {
        if (err.message === "Invalid state") {
          await auth0Client.loginWithRedirect();
        } else {
          setIsError(true);
        }
      }

      setLoading(false);
    };
    authenticate();
  }, [dispatch]);

  if (isLoading) {
    return <Loading />;
  }
  if (isError) {
    return <h1>Something went Wrong!</h1>;
  }
  if (isAuthenticated) {
    return children;
  }
  return <div />;
};

export { Auth0Provider };
