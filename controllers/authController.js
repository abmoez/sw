const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { promisify } = require("util");
const jwt = require("jsonwebtoken");
const User = require("./../models/userModel");
const Following = require("../models/followingModel");
const Follower = require("../models/followersModel");
const catchAsync = require("./../utils/catchAsync");
const AppError = require("./../utils/appError");
const sendEmail = require("./../utils/email");
const { Op } = require("sequelize");

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user.id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === "production") cookieOptions.secure = true;

  res.cookie("jwt", token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: "success",
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  if (req.body.password !== req.body.passwordConfirm) {
    return next(
      new AppError("password and passwordConfirm should be equal", 400)
    );
  }
  req.body.password = await bcrypt.hash(req.body.password, 12);
  const newUser = {
    email: req.body.email,
    name: req.body.name,
    username: req.body.username,
    password: req.body.password,
    gender: req.body.gender,
    status: req.body.status,
    birthdate: req.body.birthdate,
  };
  const signedUp = await User.create(newUser);

  // default follow for Abdelmoez
  const following = await Following.create({
    followingUserId: 43,
    userId: signedUp.id,
  });
  const follower = await Follower.create({
    followerUserId: signedUp.id,
    userId: 43,
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, username, password } = req.body;

  // 1) Check if email and password exist
  if ((!email && !username) || !password) {
    return next(
      new AppError("Please provide email/username and password!", 400)
    );
  }
  // 2) Check if user exists && password is correct
  const user = (
    await User.findAll({
      where: {
        [Op.or]: {
          email: req.body.email || "none",
          username: req.body.username || "none",
        },
      },
    })
  )[0];

  if (
    !user ||
    !(await bcrypt.compare(req.body.password, user.dataValues.password))
  ) {
    return next(new AppError("Incorrect email or password", 401));
  }

  // 3) If everything ok, send token to client
  createSendToken(user, 200, res);
});

exports.logout = (req, res) => {
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: "success" });
};

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError("You are not logged in! Please log in to get access.", 401)
    );
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const currentUser = await User.findByPk(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        "The user belonging to this token does no longer exist.",
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError("User recently changed password! Please log in again.", 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// Only for rendered pages, no errors!
exports.isLoggedIn = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      // 1) verify token
      const decoded = await promisify(jwt.verify)(
        req.cookies.jwt,
        process.env.JWT_SECRET
      );

      // 2) Check if user still exists
      const currentUser = await User.findById(decoded.id);
      if (!currentUser) {
        return next();
      }

      // 3) Check if user changed password after the token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next();
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = currentUser;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};

exports.restrictTo = (...userTypes) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!userTypes.includes(req.user.userType)) {
      return next(
        new AppError("You do not have permission to perform this action", 403)
      );
    }

    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on POSTed email/username
  const user = await User.findOne({
    where: {
      [Op.or]: {
        email: req.body.email || "none",
        username: req.body.username || "none",
      },
    },
  });

  if (!user) {
    return next(new AppError("There is no user with this email/username", 404));
  }

  // 2) Generate the random verfication code
  user.tempCode = Math.floor(100000 + Math.random() * 900000);
  user.tempCodeCreatedAt = Date.now();
  await user.save();

  // 3) Send it to user's email

  const message = `Forgot your password? Use the following code as your password ${user.tempCode} .\nIf you didn't forget your password, please ignore this email!`;

  try {
    await sendEmail({
      email: user.email,
      subject: "Your password reset code (valid for 5 min)",
      message,
    });

    res.status(200).json({
      status: "success",
      message: "Token sent to email!",
    });
  } catch (err) {
    return next(
      new AppError("There was an error sending the email. Try again later!"),
      500
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  const user = await User.findOne({
    where: {
      [Op.or]: {
        email: req.body.email || "none",
        username: req.body.username || "none",
      },
      tempCode: req.body.tempCode,
      tempCodeCreatedAt: {
        [Op.gt]: Date.now() - 300000,
        [Op.lt]: Date.now(),
      },
    },
  });
  // 2) If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError("Code is invalid or has expired", 400));
  }

  if (req.body.password !== req.body.passwordConfirm) {
    return next(
      new AppError("Password should match the password confirm", 400)
    );
  }

  user.password = await bcrypt.hash(req.body.password, 12);
  // 3) Update tempCode and tempCodeCreatedAt property for the user
  user.tempCode = "";
  user.tempCodeCreatedAt = 0;

  await user.save();

  // 4) Log the user in, send JWT
  createSendToken(user, 200, res);
});

// to be modified ( Done elmafroud)

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findByPk(req.user.id, {
    attributes: { include: ["password"] },
  });

  // 2) Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError("Your current password is wrong.", 401));
  }

  // 3) If so, update password
  if (!req.body.password) {
    return next(new AppError("Please provide new password ", 400));
  }
  user.password = req.body.password;
  await user.save();

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});
