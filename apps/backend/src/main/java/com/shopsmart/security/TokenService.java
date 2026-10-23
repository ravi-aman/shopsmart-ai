package com.shopsmart.security;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import com.shopsmart.customer.UserAccount;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class TokenService {

    private final JwtEncoder encoder;
    private final SecurityProperties props;

    public TokenService(JwtEncoder encoder, SecurityProperties props) {
        this.encoder = encoder;
        this.props = props;
    }

    public String issue(UserAccount user) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("shopsmart")
                .subject(user.id().toString())
                .issuedAt(now)
                .expiresAt(now.plus(props.security().jwtTtlMinutes(), ChronoUnit.MINUTES))
                .claim("email", user.email())
                .claim("name", user.name())
                .claim("roles", List.of(user.role()))
                .claim("tier", user.membershipTier())
                .claim("region", user.region())
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }
}
